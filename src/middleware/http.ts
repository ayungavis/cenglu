import { randomUUID } from "node:crypto";
import type { IncomingMessage, ServerResponse } from "node:http";
import { createRequestContext, LoggerContext } from "../context";
import type { Logger } from "../logger";

export interface LoggerRequest extends IncomingMessage {
  logger?: Logger;
  correlationId?: string;
  startTime?: number;
}

export interface LoggerResponse extends ServerResponse {
  // No additional properties needed
}

export type HttpMiddlewareOptions = {
  /**
   * Log incoming requests
   * @default true
   */
  logRequests?: boolean;

  /**
   * Log outgoing responses
   * @default true
   */
  logResponses?: boolean;

  /**
   * Header name for correlation ID
   * @default "x-correlation-id"
   */
  correlationIdHeader?: string;

  /**
   * Custom correlation ID generator
   * @default randomUUID
   */
  generateCorrelationId?: () => string;

  /**
   * Paths to skip logging
   */
  ignorePaths?: (string | RegExp)[];

  /**
   * Custom skip function
   */
  skip?: (req: LoggerRequest, res: LoggerResponse) => boolean;

  /**
   * Whether to use AsyncLocalStorage
   * @default true
   */
  useAsyncContext?: boolean;
};

const DEFAULT_OPTIONS: Required<HttpMiddlewareOptions> = {
  logRequests: true,
  logResponses: true,
  correlationIdHeader: "x-correlation-id",
  generateCorrelationId: randomUUID,
  ignorePaths: [],
  skip: () => false,
  useAsyncContext: true,
};

function getHeader(req: IncomingMessage, name: string): string | undefined {
  const value = req.headers[name] ?? req.headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getPath(req: IncomingMessage): string {
  const url = req.url ?? "/";
  const queryIndex = url.indexOf("?");
  return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
}

function shouldIgnorePath(path: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === "string") {
      return path === pattern || path.startsWith(pattern);
    }
    return pattern.test(path);
  });
}

function getLogLevel(statusCode: number): "info" | "warn" | "error" {
  if (statusCode >= 500) {
    return "error";
  }
  if (statusCode >= 400) {
    return "warn";
  }
  return "info";
}

/**
 * Create middleware for Node.js HTTP server
 *
 * This works with the native http module and any framework built on it.
 *
 * @example
 * import http from "node:http";
 * import { createLogger } from "cenglu";
 * import { httpMiddleware } from "cenglu/middleware";
 *
 * const logger = createLogger({ service: "api" });
 * const middleware = httpMiddleware(logger);
 *
 * const server = http.createServer((req, res) => {
 *   middleware(req, res, () => {
 *     // Your handler here
 *     req.logger?.info("Handling request");
 *     res.end("Hello");
 *   });
 * });
 */
export function httpMiddleware(
  logger: Logger,
  options: HttpMiddlewareOptions = {}
): (req: LoggerRequest, res: LoggerResponse, next: () => void) => void {
  const opts = { ...DEFAULT_OPTIONS, ...options };

  return (req: LoggerRequest, res: LoggerResponse, next: () => void): void => {
    const path = getPath(req);
    const method = req.method ?? "GET";

    // Check if we should skip
    if (shouldIgnorePath(path, opts.ignorePaths)) {
      // biome-ignore lint/correctness/noVoidTypeReturn: follows convention
      return next();
    }

    if (opts.skip(req, res)) {
      // biome-ignore lint/correctness/noVoidTypeReturn: follows convention
      return next();
    }

    // Extract or generate correlation ID
    let correlationId = getHeader(req, opts.correlationIdHeader);

    if (!correlationId) {
      correlationId = getHeader(req, "x-request-id") ?? opts.generateCorrelationId();
    }

    // Set correlation ID on response
    res.setHeader(opts.correlationIdHeader, correlationId);

    // Record start time
    const startTime = Date.now();
    req.startTime = startTime;

    // Attach to request
    req.correlationId = correlationId;

    // Create child logger
    const requestLogger = logger.child({
      correlationId,
      method,
      path,
    });
    req.logger = requestLogger;

    // Log request
    if (opts.logRequests) {
      requestLogger.info(`${method} ${path}`, {
        url: req.url,
        headers: {
          host: req.headers.host,
          "user-agent": req.headers["user-agent"],
        },
      });
    }

    // Log response on finish
    if (opts.logResponses) {
      res.on("finish", () => {
        const duration = Date.now() - startTime;
        const level = getLogLevel(res.statusCode);

        requestLogger[level](`${method} ${path} ${res.statusCode} ${duration}ms`, {
          statusCode: res.statusCode,
          duration,
        });
      });
    }

    // Handle with or without AsyncLocalStorage
    if (opts.useAsyncContext) {
      const context = createRequestContext({
        id: correlationId,
        correlationId,
        headers: req.headers as Record<string, string | string[] | undefined>,
        method,
        url: req.url ?? "/",
        path,
      });

      LoggerContext.run(context, next);
    } else {
      next();
    }
  };
}

export const createHttpMiddleware = httpMiddleware;

/**
 * Wrap an HTTP handler with logging middleware
 *
 * @example
 * import http from "node:http";
 * import { createLogger } from "cenglu";
 * import { wrapHttpHandler } from "cenglu/middleware";
 *
 * const logger = createLogger({ service: "api" });
 *
 * const handler = wrapHttpHandler(logger, (req, res) => {
 *   req.logger?.info("Handling request");
 *   res.end("Hello");
 * });
 *
 * http.createServer(handler).listen(3000);
 */
export function wrapHttpHandler(
  logger: Logger,
  handler: (req: LoggerRequest, res: LoggerResponse) => void,
  options?: HttpMiddlewareOptions
): (req: IncomingMessage, res: ServerResponse) => void {
  const middleware = httpMiddleware(logger, options);

  return (req: IncomingMessage, res: ServerResponse): void => {
    middleware(req as LoggerRequest, res as LoggerResponse, () => {
      handler(req as LoggerRequest, res as LoggerResponse);
    });
  };
}
