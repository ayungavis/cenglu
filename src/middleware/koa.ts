import { randomUUID } from "node:crypto";
import { createRequestContext, LoggerContext } from "../context";
import type { Logger } from "../logger";
import type { Bindings } from "../types";

export type KoaContext = {
  // Request properties
  method: string;
  url: string;
  path: string;
  originalUrl: string;
  query: Record<string, unknown>;
  headers: Record<string, string | string[] | undefined>;
  ip: string;
  ips: string[];
  host: string;
  hostname: string;
  protocol: string;
  secure: boolean;

  // Request object
  request: {
    method: string;
    url: string;
    path: string;
    query: Record<string, unknown>;
    headers: Record<string, string | string[] | undefined>;
    body?: unknown;
    [key: string]: unknown;
  };

  // Response properties
  status: number;
  message: string;
  body?: unknown;

  // Response object
  response: {
    status: number;
    message: string;
    body?: unknown;
    headers: Record<string, string | string[] | undefined>;
    [key: string]: unknown;
  };

  // Methods
  set(field: string, value: string | string[]): void;
  get(field: string): string;
  throw(status: number, message?: string): never;

  // State
  state: Record<string, unknown>;

  // Added by middleware
  logger?: Logger;
  correlationId?: string;

  app?: {
    emit?: (event: string, ...args: unknown[]) => boolean;
    [key: string]: unknown;
  };

  [key: string]: unknown;
};

export type KoaNext = () => Promise<void>;

export type KoaMiddlewareOptions = {
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
   * @default false
   */
  includeHeaders?: boolean;

  /**
   * Include request query in logs
   * @default true
   */
  includeQuery?: boolean;

  /**
   * Include request body in logs
   * @default false
   */
  includeBody?: boolean;

  /**
   * Include response body in logs
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
  skip?: (ctx: KoaContext) => boolean;

  /**
   * Custom request message
   */
  requestMessage?: (ctx: KoaContext) => string;

  /**
   * Custom response message
   */
  responseMessage?: (ctx: KoaContext, duration: number) => string;

  /**
   * Headers to redact
   * @default ["authorization", "cookie"]
   */
  redactHeaders?: string[];

  /**
   * Whether to use AsyncLocalStorage
   * @default true
   */
  useAsyncContext?: boolean;

  /**
   * Log level for successful requests
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
};

const DEFAULT_OPTIONS = {
  logRequests: true,
  logResponses: true,
  includeHeaders: false,
  includeQuery: true,
  includeBody: false,
  includeResponseBody: false,
  maxResponseBodyLength: 1000,
  correlationIdHeader: "x-correlation-id",
  generateCorrelationId: randomUUID,
  ignorePaths: [] as (string | RegExp)[],
  skip: () => false,
  requestMessage: (ctx: KoaContext) => `${ctx.method} ${ctx.path}`,
  responseMessage: (ctx: KoaContext, duration: number) =>
    `${ctx.method} ${ctx.path} ${ctx.status} ${duration}ms`,
  redactHeaders: ["authorization", "cookie", "set-cookie"],
  useAsyncContext: true,
  successLevel: "info" as const,
  clientErrorLevel: "warn" as const,
  serverErrorLevel: "error" as const,
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
): Record<string, unknown> {
  const redactSet = new Set(redactHeaders.map((h) => h.toLowerCase()));
  const result: Record<string, unknown> = {};

  for (const [key, value] of Object.entries(headers)) {
    if (redactSet.has(key.toLowerCase())) {
      result[key] = "[REDACTED]";
    } else {
      result[key] = value;
    }
  }

  return result;
}

function getLogLevel(
  statusCode: number,
  opts: Required<KoaMiddlewareOptions>
): "trace" | "debug" | "info" | "warn" | "error" | "fatal" {
  if (statusCode >= 500) {
    return opts.serverErrorLevel;
  }
  if (statusCode >= 400) {
    return opts.clientErrorLevel;
  }
  return opts.successLevel;
}

function truncateBody(body: unknown, maxLength: number): unknown {
  if (typeof body === "string") {
    return body.length > maxLength ? `${body.slice(0, maxLength)}... (truncated)` : body;
  }

  try {
    const str = JSON.stringify(body);
    if (str.length > maxLength) {
      return `${str.slice(0, maxLength)}... (truncated)`;
    }
    return body;
  } catch {
    return "[Unable to serialize]";
  }
}

/**
 * Create Koa middleware for request logging and context propagation
 *
 * @example
 * import Koa from "koa";
 * import { createLogger } from "cenglu";
 * import { koaMiddleware } from "cenglu/middleware";
 *
 * const app = new Koa();
 * const logger = createLogger({ service: "api" });
 *
 * app.use(koaMiddleware(logger, {
 *   ignorePaths: ["/health"],
 * }));
 *
 * app.use(async (ctx) => {
 *   ctx.logger.info("Processing request");
 *   ctx.body = { message: "Hello" };
 * });
 */
export function koaMiddleware(
  logger: Logger,
  options: KoaMiddlewareOptions = {}
): (ctx: KoaContext, next: KoaNext) => Promise<void> {
  const opts: Required<KoaMiddlewareOptions> = { ...DEFAULT_OPTIONS, ...options };

  return async (ctx: KoaContext, next: KoaNext): Promise<void> => {
    // Check if we should skip
    if (shouldIgnorePath(ctx.path, opts.ignorePaths)) {
      return next();
    }

    if (opts.skip(ctx)) {
      return next();
    }

    // Extract or generate correlation ID
    let correlationId = getHeader(ctx.headers, opts.correlationIdHeader);

    if (!correlationId) {
      correlationId = getHeader(ctx.headers, "x-request-id") ?? opts.generateCorrelationId();
    }

    // Set correlation ID on response
    ctx.set(opts.correlationIdHeader, correlationId);

    // Attach to context
    ctx.correlationId = correlationId;

    // Create child logger
    const requestLogger = logger.child({
      correlationId,
      method: ctx.method,
      path: ctx.path,
    });
    ctx.logger = requestLogger;

    // Also attach to state for consistency
    ctx.state.logger = requestLogger;
    ctx.state.correlationId = correlationId;

    function logRequest(): void {
      if (!opts.logRequests) {
        return;
      }

      const requestData: Bindings = {
        url: ctx.originalUrl || ctx.url,
      };

      if (opts.includeQuery && ctx.query && Object.keys(ctx.query).length > 0) {
        requestData.query = ctx.query;
      }

      if (opts.includeHeaders) {
        requestData.headers = sanitizeHeaders(ctx.headers, opts.redactHeaders);
      }

      if (opts.includeBody && ctx.request.body !== undefined) {
        requestData.body = ctx.request.body;
      }

      requestLogger.info(opts.requestMessage(ctx), requestData);
    }

    function logResponse(duration: number, error?: Error): void {
      if (!opts.logResponses) {
        return;
      }

      const level = error ? "error" : getLogLevel(ctx.status, opts);

      const responseData: Bindings = {
        statusCode: ctx.status,
        duration,
      };

      if (opts.includeResponseBody && ctx.body !== undefined) {
        responseData.body = truncateBody(ctx.body, opts.maxResponseBodyLength);
      }

      if (error) {
        requestLogger[level](opts.responseMessage(ctx, duration), error, responseData);
      } else {
        requestLogger[level](opts.responseMessage(ctx, duration), responseData);
      }
    }

    async function handleRequest(): Promise<void> {
      logRequest();

      const startTime = Date.now();
      let error: Error | undefined;

      try {
        await next();
      } catch (err) {
        error = err instanceof Error ? err : new Error(String(err));

        // Set status for error
        ctx.status =
          (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;

        throw err;
      } finally {
        const duration = Date.now() - startTime;
        logResponse(duration, error);
      }
    }

    // Run with or without AsyncLocalStorage
    if (opts.useAsyncContext) {
      const context = createRequestContext({
        id: correlationId,
        correlationId,
        headers: ctx.headers,
        method: ctx.method,
        url: ctx.url,
        path: ctx.path,
        ip: ctx.ip,
      });

      await LoggerContext.runAsync(context, handleRequest);
    } else {
      await handleRequest();
    }
  };
}

export const createKoaMiddleware = koaMiddleware;

/**
 * Koa error handling middleware
 *
 * This should be added early in the middleware chain to catch all errors.
 *
 * @example
 * app.use(koaErrorMiddleware(logger));
 * app.use(koaMiddleware(logger));
 * // ... other middleware
 */
export function koaErrorMiddleware(
  logger: Logger,
  options: {
    /**
     * Whether to expose error details in response
     * @default false in production
     */
    exposeErrors?: boolean;

    /**
     * Custom error response formatter
     */
    formatError?: (err: Error, ctx: KoaContext) => unknown;

    /**
     * Whether to emit error event on app
     * @default true
     */
    emitError?: boolean;
  } = {}
): (ctx: KoaContext, next: KoaNext) => Promise<void> {
  const {
    exposeErrors = process.env.NODE_ENV !== "production",
    formatError,
    emitError = true,
  } = options;

  return async (ctx: KoaContext, next: KoaNext): Promise<void> => {
    try {
      await next();
    } catch (err) {
      const error = err instanceof Error ? err : new Error(String(err));
      const log = ctx.logger ?? logger;

      // Determine status code
      const status =
        (err as { status?: number }).status ?? (err as { statusCode?: number }).statusCode ?? 500;

      // Log error
      log.error("Request error", error, {
        status,
        path: ctx.path,
        method: ctx.method,
      });

      // Set response
      ctx.status = status;
      ctx.body = formatError
        ? formatError(error, ctx)
        : {
            error: {
              message: exposeErrors ? error.message : "Internal Server Error",
              ...(exposeErrors && { stack: error.stack }),
            },
            correlationId: ctx.correlationId,
          };

      // Emit error event
      if (emitError) {
        ctx.app?.emit?.("error", err, ctx);
      }
    }
  };
}
