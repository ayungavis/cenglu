import { randomUUID } from "node:crypto";
import { createRequestContext, LoggerContext } from "../context";
import type { Logger } from "../logger";
import type { Bindings } from "../types";

export type ExpressRequest = {
  method: string;
  url: string;
  path: string;
  originalUrl: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  body?: unknown;
  ip?: string;
  ips?: string[];
  protocol?: string;
  secure?: boolean;
  hostname?: string;

  // Added by middleware
  logger?: Logger;
  correlationId?: string;
  requestId?: string;
  startTime?: number;

  // Allow additional properties
  [key: string]: unknown;
};

export type ExpressResponse = {
  statusCode: number;
  statusMessage?: string;
  headersSent: boolean;

  setHeader(name: string, value: string | number | readonly string[]): ExpressResponse;
  getHeader(name: string): string | number | string[] | undefined;
  removeHeader(name: string): void;

  on(event: string, listener: (...args: unknown[]) => void): ExpressResponse;
  once(event: string, listener: (...args: unknown[]) => void): ExpressResponse;
  end(chunk?: unknown, encoding?: string, callback?: (...args: unknown[]) => void): void;

  // Allow additional properties
  [key: string]: unknown;
};

export type ExpressNextFunction = (err?: unknown) => void;

export type ExpressMiddlewareOptions = {
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
   * Include request headers in logs
   * Note: May contain sensitive data
   * @default false
   */
  includeHeaders?: boolean;

  /**
   * Include request query parameters in logs
   * @default true
   */
  includeQuery?: boolean;

  /**
   * Include request body in logs
   * Note: May contain sensitive data and requires body-parser
   * @default false
   */
  includeBody?: boolean;

  /**
   * Include response body in logs
   * Note: Requires response capturing which may impact performance
   * @default false
   */
  includeResponseBody?: boolean;

  /**
   * Maximum response body length to log
   * @default 1000
   */
  maxResponseBodyLength?: number;

  /**
   * Header name for correlation ID
   * @default "x-correlation-id"
   */
  correlationIdHeader?: string;

  /**
   * Alternative header names to check for correlation ID
   * @default ["x-request-id", "request-id"]
   */
  correlationIdFallbackHeaders?: string[];

  /**
   * Custom correlation ID generator
   * @default randomUUID
   */
  generateCorrelationId?: () => string;

  /**
   * Whether to set correlation ID on response headers
   * @default true
   */
  setCorrelationIdHeader?: boolean;

  /**
   * Paths to skip logging for (e.g., health checks)
   * Supports strings and RegExp
   */
  ignorePaths?: (string | RegExp)[];

  /**
   * Custom skip function
   * Return true to skip logging for this request
   */
  skip?: (req: ExpressRequest, res: ExpressResponse) => boolean;

  /**
   * Custom request message
   */
  requestMessage?: (req: ExpressRequest) => string;

  /**
   * Custom response message
   */
  responseMessage?: (req: ExpressRequest, res: ExpressResponse, duration: number) => string;

  /**
   * Custom request context extractor
   */
  getRequestContext?: (req: ExpressRequest) => Bindings;

  /**
   * Custom response context extractor
   */
  getResponseContext?: (req: ExpressRequest, res: ExpressResponse, duration: number) => Bindings;

  /**
   * Headers to redact from logs
   * @default ["authorization", "cookie", "set-cookie"]
   */
  redactHeaders?: string[];

  /**
   * Log level for successful requests (2xx, 3xx)
   * @default "info"
   */
  successLevel?: "trace" | "debug" | "info";

  /**
   * Log level for client errors (4xx)
   * @default "warn"
   */
  clientErrorLevel?: "info" | "warn" | "error";

  /**
   * Log level for server errors (5xx)
   * @default "error"
   */
  serverErrorLevel?: "warn" | "error" | "fatal";

  /**
   * Whether to use AsyncLocalStorage for context propagation
   * @default true
   */
  useAsyncContext?: boolean;

  /**
   * Property name to attach logger to request
   * @default "logger"
   */
  loggerProperty?: string;

  /**
   * Property name to attach correlation ID to request
   * @default "correlationId"
   */
  correlationIdProperty?: string;
};

const DEFAULT_OPTIONS: Required<ExpressMiddlewareOptions> = {
  logRequests: true,
  logResponses: true,
  includeHeaders: false,
  includeQuery: true,
  includeBody: false,
  includeResponseBody: false,
  maxResponseBodyLength: 1000,
  correlationIdHeader: "x-correlation-id",
  correlationIdFallbackHeaders: ["x-request-id", "request-id"],
  generateCorrelationId: randomUUID,
  setCorrelationIdHeader: true,
  ignorePaths: [],
  skip: () => false,
  requestMessage: (req) => `${req.method} ${req.path}`,
  responseMessage: (req, res, duration) =>
    `${req.method} ${req.path} ${res.statusCode} ${duration}ms`,
  getRequestContext: () => ({}),
  getResponseContext: () => ({}),
  redactHeaders: ["authorization", "cookie", "set-cookie", "x-api-key"],
  successLevel: "info",
  clientErrorLevel: "warn",
  serverErrorLevel: "error",
  useAsyncContext: true,
  loggerProperty: "logger",
  correlationIdProperty: "correlationId",
};

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function shouldIgnorePath(path: string, patterns: (string | RegExp)[]): boolean {
  return patterns.some((pattern) => {
    if (typeof pattern === "string") {
      return path === pattern || path.startsWith(pattern);
    }
    return pattern.test(path);
  });
}

function sanitizeHeaders(
  headers: Record<string, string | string[] | undefined>,
  redactHeaders: string[]
): Record<string, string | string[] | undefined> {
  const redactSet = new Set(redactHeaders.map((h) => h.toLowerCase()));
  const result: Record<string, string | string[] | undefined> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (redactSet.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }

  return result;
}

function getClientIp(req: ExpressRequest): string | undefined {
  // Check X-Forwarded-For header first
  const forwarded = getHeader(req.headers, "x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim();
  }

  // Check X-Real-IP header
  const realIp = getHeader(req.headers, "x-real-ip");
  if (realIp) {
    return realIp;
  }

  // Fall back to req.ip or connection info
  return req.ip ?? req.ips?.[0];
}

function getLogLevel(
  statusCode: number,
  options: Required<ExpressMiddlewareOptions>
): "trace" | "debug" | "info" | "warn" | "error" | "fatal" {
  if (statusCode >= 500) {
    return options.serverErrorLevel;
  }
  if (statusCode >= 400) {
    return options.clientErrorLevel;
  }
  return options.successLevel;
}

/**
 * Create Express middleware for request logging and context propagation
 *
 * @param logger - The logger instance to use
 * @param options - Middleware options
 * @returns Express middleware function
 *
 * @example
 * import express from "express";
 * import { createLogger } from "cenglu";
 * import { expressMiddleware } from "cenglu/middleware";
 *
 * const app = express();
 * const logger = createLogger({ service: "api" });
 *
 * // Basic usage
 * app.use(expressMiddleware(logger));
 *
 * // With options
 * app.use(expressMiddleware(logger, {
 *   ignorePaths: ["/health", "/ready", /^\/metrics/],
 *   includeQuery: true,
 *   correlationIdHeader: "x-trace-id",
 * }));
 *
 * app.get("/users/:id", (req, res) => {
 *   // Logger is attached to request with request context
 *   req.logger.info("Fetching user", { userId: req.params.id });
 *
 *   // Correlation ID is also attached
 *   console.log("Request ID:", req.correlationId);
 *
 *   res.json({ id: req.params.id });
 * });
 */
export function expressMiddleware(
  logger: Logger,
  options: ExpressMiddlewareOptions = {}
): (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => void {
  const opts: Required<ExpressMiddlewareOptions> = {
    ...DEFAULT_OPTIONS,
    ...options,
  };

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: needed for logic
  return (req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction): void => {
    // Check if we should skip this request
    if (shouldIgnorePath(req.path, opts.ignorePaths)) {
      // biome-ignore lint/correctness/noVoidTypeReturn: express next function
      return next();
    }

    if (opts.skip(req, res)) {
      // biome-ignore lint/correctness/noVoidTypeReturn: express next function
      return next();
    }

    // Extract or generate correlation ID
    let correlationId = getHeader(req.headers, opts.correlationIdHeader);

    if (!correlationId) {
      for (const header of opts.correlationIdFallbackHeaders) {
        correlationId = getHeader(req.headers, header);
        if (correlationId) {
          break;
        }
      }
    }

    if (!correlationId) {
      correlationId = opts.generateCorrelationId();
    }

    // Set correlation ID on response
    if (opts.setCorrelationIdHeader) {
      res.setHeader(opts.correlationIdHeader, correlationId);
    }

    // Record start time
    const startTime = Date.now();
    req.startTime = startTime;

    // Attach correlation ID to request
    (req as Record<string, unknown>)[opts.correlationIdProperty] = correlationId;
    req.requestId = correlationId;

    // Create request context for AsyncLocalStorage
    const requestContext = createRequestContext({
      id: correlationId,
      correlationId,
      headers: req.headers,
      method: req.method,
      url: req.originalUrl || req.url,
      path: req.path,
      ip: getClientIp(req),
      userAgent: getHeader(req.headers, "user-agent"),
    });

    // Add custom context
    const customContext = opts.getRequestContext(req);
    if (customContext && Object.keys(customContext).length > 0 && requestContext.bindings) {
      Object.assign(requestContext.bindings, customContext);
    }

    // Create child logger with request context
    const requestLogger = logger.child({
      correlationId,
      method: req.method,
      path: req.path,
    });

    // Attach logger to request
    (req as Record<string, unknown>)[opts.loggerProperty] = requestLogger;

    function logRequest(): void {
      if (!opts.logRequests) {
        return;
      }

      const requestData: Bindings = {
        url: req.originalUrl || req.url,
      };

      if (opts.includeQuery && req.query && Object.keys(req.query).length > 0) {
        requestData.query = req.query;
      }

      if (opts.includeHeaders) {
        requestData.headers = sanitizeHeaders(req.headers, opts.redactHeaders);
      }

      if (opts.includeBody && req.body !== undefined) {
        requestData.body = req.body;
      }

      if (req.params && Object.keys(req.params).length > 0) {
        requestData.params = req.params;
      }

      requestLogger.info(opts.requestMessage(req), requestData);
    }

    function logResponse(): void {
      if (!opts.logResponses) {
        return;
      }

      const duration = Date.now() - startTime;
      const level = getLogLevel(res.statusCode, opts);

      const responseData: Bindings = {
        statusCode: res.statusCode,
        duration,
        ...opts.getResponseContext(req, res, duration),
      };

      requestLogger[level](opts.responseMessage(req, res, duration), responseData);
    }

    function handleRequest(): void {
      // Log request
      logRequest();

      // Listen for response finish
      res.once("finish", logResponse);

      // Continue to next middleware
      next();
    }

    // Run with or without AsyncLocalStorage context
    if (opts.useAsyncContext) {
      LoggerContext.run(requestContext, handleRequest);
    } else {
      handleRequest();
    }
  };
}

export const createExpressMiddleware = expressMiddleware;

/**
 * Express error handling middleware
 *
 * This should be added after all other middleware and routes
 * to catch and log errors.
 *
 * @example
 * app.use(expressErrorMiddleware(logger));
 */
export function expressErrorMiddleware(
  logger: Logger,
  options: {
    /**
     * Whether to include stack trace in response
     * @default false in production
     */
    includeStack?: boolean;

    /**
     * Custom error response formatter
     */
    formatError?: (err: Error, req: ExpressRequest) => unknown;

    /**
     * Whether to continue to next error handler
     * @default false
     */
    continueOnError?: boolean;
  } = {}
): (err: Error, req: ExpressRequest, res: ExpressResponse, next: ExpressNextFunction) => void {
  const {
    includeStack = process.env.NODE_ENV !== "production",
    formatError,
    continueOnError = false,
  } = options;

  return (
    err: Error,
    req: ExpressRequest,
    res: ExpressResponse,
    next: ExpressNextFunction
  ): void => {
    // Use request logger if available, otherwise use main logger
    const log = (req as { logger?: Logger }).logger ?? logger;

    // Determine status code
    const statusCode =
      (err as { statusCode?: number }).statusCode ?? (err as { status?: number }).status ?? 500;

    // Log the error
    log.error("Request error", err, {
      statusCode,
      path: req.path,
      method: req.method,
    });

    // If headers already sent, delegate to default Express error handler
    if (res.headersSent) {
      // biome-ignore lint/correctness/noVoidTypeReturn: express next function
      return next(err);
    }

    // Format error response
    const errorResponse = formatError
      ? formatError(err, req)
      : {
          error: {
            message: err.message,
            code: (err as { code?: string }).code,
            ...(includeStack && { stack: err.stack }),
          },
          correlationId: (req as { correlationId?: string }).correlationId,
        };

    // Send error response
    res.statusCode = statusCode;
    res.setHeader("Content-Type", "application/json");
    res.end(JSON.stringify(errorResponse));

    // Continue to next error handler if configured
    if (continueOnError) {
      next(err);
    }
  };
}
