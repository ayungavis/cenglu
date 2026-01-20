import { randomUUID } from "crypto";
import { createRequestContext, LoggerContext } from "../context";
import type Logger from "../logger";
import type { Bindings } from "../types";

export type Injectable = {
  new (...args: unknown[]): unknown;
};

export type NestRequest = {
  method: string;
  url: string;
  originalUrl?: string;
  path?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  params?: Record<string, string>;
  body?: unknown;
  ip?: string;
  ips?: string[];
  user?: unknown;

  // Added by middleware
  logger?: Logger;
  correlationId?: string;
  requestId?: string;
  startTime?: number;

  [key: string]: unknown;
};

// biome-ignore lint/style/useConsistentTypeDefinitions: used for `this`
export interface NestResponse {
  statusCode: number;

  setHeader(name: string, value: string): this;
  getHeader(name: string): string | undefined;
  on(event: string, listener: (...args: unknown[]) => void): this;

  [key: string]: unknown;
}

export type NestNextFunction = () => void | Promise<void>;

export type NestMiddleware = {
  use(req: NestRequest, res: NestResponse, next: NestNextFunction): void | Promise<void>;
};

export type ExecutionContext = {
  switchToHttp(): {
    getRequest<T = NestRequest>(): T;
    getResponse<T = NestResponse>(): T;
    getNext<T = NestNextFunction>(): T;
  };
  getClass(): unknown;
  getHandler(): unknown;
  getType(): string;
  getArgs(): unknown[];
  getArgByIndex(index: number): unknown;
};

export type CallHandler<T = unknown> = {
  handle(): Observable<T>;
};

export type Observable<T> = {
  pipe(...operators: unknown[]): Observable<T>;
  subscribe(observer: {
    next?: (value: T) => void;
    error?: (err: unknown) => void;
    complete?: () => void;
  }): { unsubscribe(): void };
};

export type LoggerService = {
  log(message: string, context?: string): void;
  error(message: string, trace?: string, context?: string): void;
  warn(message: string, context?: string): void;
  debug?(message: string, context?: string): void;
  verbose?(message: string, context?: string): void;
  fatal?(message: string, context?: string): void;
  setLogLevels?(levels: string[]): void;
};

export type NestMiddlewareOptions = {
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
   * Include request params in logs
   * @default true
   */
  includeParams?: boolean;

  /**
   * Include user info in logs (from req.user)
   * @default false
   */
  includeUser?: boolean;

  /**
   * Function to extract user ID from request
   */
  getUserId?: (req: NestRequest) => string | undefined;

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
  excludePaths?: (string | RegExp)[];

  /**
   * Custom skip function
   */
  skip?: (req: NestRequest, res: NestResponse) => boolean;

  /**
   * Custom request message
   */
  requestMessage?: (req: NestRequest) => string;

  /**
   * Custom response message
   */
  responseMessage?: (req: NestRequest, res: NestResponse, duration: number) => string;

  /**
   * Headers to redact from logs
   * @default ["authorization", "cookie", "set-cookie"]
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

export interface NestInterceptorOptions extends NestMiddlewareOptions {
  /**
   * Include handler class name in logs
   * @default true
   */
  includeHandler?: boolean;

  /**
   * Include controller name in logs
   * @default true
   */
  includeController?: boolean;
}

export type NestLoggerModuleOptions = {
  /**
   * The logger instance to use
   */
  logger: Logger;

  /**
   * Middleware options
   */
  middleware?: NestMiddlewareOptions;

  /**
   * Whether to replace NestJS's default logger
   * @default true
   */
  replaceNestLogger?: boolean;

  /**
   * Whether to register as global module
   * @default true
   */
  isGlobal?: boolean;
};

const DEFAULT_OPTIONS: Required<NestMiddlewareOptions> = {
  logRequests: true,
  logResponses: true,
  includeHeaders: false,
  includeQuery: true,
  includeBody: false,
  includeParams: true,
  includeUser: false,
  getUserId: (req) => {
    const user = req.user as { id?: string; userId?: string; sub?: string } | undefined;
    return user?.id ?? user?.userId ?? user?.sub;
  },
  correlationIdHeader: "x-correlation-id",
  generateCorrelationId: randomUUID,
  excludePaths: [],
  skip: () => false,
  requestMessage: (req) => `${req.method} ${getPath(req)}`,
  responseMessage: (req, res, duration) =>
    `${req.method} ${getPath(req)} ${res.statusCode} ${duration}ms`,
  redactHeaders: ["authorization", "cookie", "set-cookie", "x-api-key"],
  useAsyncContext: true,
  successLevel: "info",
  clientErrorLevel: "warn",
  serverErrorLevel: "error",
};

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function getPath(req: NestRequest): string {
  return req.path ?? req.originalUrl?.split("?")[0] ?? req.url?.split("?")[0] ?? "/";
}

function shouldExcludePath(path: string, patterns: (string | RegExp)[]): boolean {
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

function getClientIp(req: NestRequest): string | undefined {
  const forwarded = getHeader(req.headers, "x-forwarded-for");
  if (forwarded) {
    return forwarded.split(",")[0]?.trim();
  }
  const realIp = getHeader(req.headers, "x-real-ip");
  if (realIp) {
    return realIp;
  }
  return req.ip ?? req.ips?.[0];
}

function getLogLevel(
  statusCode: number,
  options: Required<NestMiddlewareOptions>
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
 * Adapter to use cenglu logger as NestJS LoggerService
 *
 * This allows you to replace NestJS's default logger with cenglu.
 *
 * @example
 * // main.ts
 * import { NestFactory } from "@nestjs/core";
 * import { createLogger } from "cenglu";
 * import { NestLoggerService } from "cenglu/middleware";
 *
 * const logger = createLogger({ service: "my-app" });
 * const app = await NestFactory.create(AppModule, {
 *   logger: new NestLoggerService(logger),
 * });
 */
export class NestLoggerService implements LoggerService {
  private readonly logger: Logger;
  private readonly context?: string;

  constructor(logger: Logger, context?: string) {
    this.logger = logger;
    this.context = context;
  }

  setContext(context: string): NestLoggerService {
    return new NestLoggerService(this.logger.child({ nestContext: context }), context);
  }

  getLogger(): Logger {
    return this.logger;
  }

  log(message: string, context?: string): void {
    this.logger.info(message, this.buildContext(context));
  }

  error(message: string, traceOrContext?: string, context?: string): void {
    // NestJS passes trace as second arg, context as third
    // But sometimes it's just (message, context)
    let trace: string | undefined;
    let ctx: string | undefined;

    if (context !== undefined) {
      trace = traceOrContext;
      ctx = context;
    } else if (traceOrContext?.includes("\n") || traceOrContext?.includes("at ")) {
      // Looks like a stack trace
      trace = traceOrContext;
    } else {
      ctx = traceOrContext;
    }

    const logContext = this.buildContext(ctx);

    if (trace) {
      // Create an error object from the trace
      const error = new Error(message);
      error.stack = trace;
      this.logger.error(message, error, logContext);
    } else {
      this.logger.error(message, logContext);
    }
  }

  warn(message: string, context?: string): void {
    this.logger.warn(message, this.buildContext(context));
  }

  debug(message: string, context?: string): void {
    this.logger.debug(message, this.buildContext(context));
  }

  verbose(message: string, context?: string): void {
    this.logger.trace(message, this.buildContext(context));
  }

  fatal(message: string, context?: string): void {
    this.logger.fatal(message, this.buildContext(context));
  }

  setLogLevels(_levels: string[]): void {
    // NestJS uses this to filter log levels
    // We handle this through our own level configuration
  }

  private buildContext(context?: string): Bindings {
    const ctx: Bindings = {};

    if (context) {
      ctx.nestContext = context;
    } else if (this.context) {
      ctx.nestContext = this.context;
    }

    return ctx;
  }
}

/**
 * NestJS middleware for request logging
 *
 * @example
 * // app.module.ts
 * import { Module, NestModule, MiddlewareConsumer } from "@nestjs/common";
 * import { createLogger } from "cenglu";
 * import { createNestMiddleware } from "cenglu/middleware";
 *
 * const logger = createLogger({ service: "my-app" });
 *
 * @Module({})
 * export class AppModule implements NestModule {
 *   configure(consumer: MiddlewareConsumer) {
 *     consumer
 *       .apply(createNestMiddleware(logger, {
 *         excludePaths: ["/health", "/ready"],
 *       }))
 *       .forRoutes("*");
 *   }
 * }
 */
export function createNestMiddleware(
  logger: Logger,
  options: NestMiddlewareOptions = {}
): new () => NestMiddleware {
  const opts: Required<NestMiddlewareOptions> = { ...DEFAULT_OPTIONS, ...options };

  class LoggerMiddleware implements NestMiddleware {
    use(req: NestRequest, res: NestResponse, next: NestNextFunction) {
      const path = getPath(req);

      if (shouldExcludePath(path, opts.excludePaths)) {
        return next();
      }

      if (opts.skip(req, res)) {
        return next();
      }

      let correlationId = getHeader(req.headers, opts.correlationIdHeader);
      if (!correlationId) {
        correlationId = getHeader(req.headers, "x-request-id") ?? opts.generateCorrelationId();
      }

      res.setHeader(opts.correlationIdHeader, correlationId);

      const startTime = Date.now();
      req.startTime = startTime;
      req.correlationId = correlationId;
      req.requestId = correlationId;

      const requestLogger = logger.child({
        correlationId,
        method: req.method,
        path,
      });
      req.logger = requestLogger;

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep it like this for now
      const buildContext = (): Bindings => {
        const ctx: Bindings = {
          url: req.originalUrl ?? req.url,
        };

        if (opts.includeQuery && req.query && Object.keys(req.query).length > 0) {
          ctx.query = req.query;
        }

        if (opts.includeParams && req.params && Object.keys(req.params).length > 0) {
          ctx.params = req.params;
        }

        if (opts.includeHeaders) {
          ctx.headers = sanitizeHeaders(req.headers, opts.redactHeaders);
        }

        if (opts.includeBody && req.body !== undefined) {
          ctx.body = req.body;
        }

        if (opts.includeUser && req.user) {
          const userId = opts.getUserId(req);
          if (userId) {
            ctx.userId = userId;
          }
        }

        return ctx;
      };

      const logRequest = (): void => {
        if (opts.logRequests) {
          requestLogger.info(opts.requestMessage(req), buildContext());
        }
      };

      const logResponse = (): void => {
        if (opts.logResponses) {
          const duration = Date.now() - startTime;
          const level = getLogLevel(res.statusCode, opts);

          requestLogger[level](opts.responseMessage(req, res, duration), {
            statusCode: res.statusCode,
            duration,
          });
        }
      };

      const handleRequest = (): void => {
        logRequest();
        res.on("finish", logResponse);
        next();
      };

      if (opts.useAsyncContext) {
        const context = createRequestContext({
          id: correlationId,
          correlationId,
          headers: req.headers,
          method: req.method,
          url: req.url,
          path,
          ip: getClientIp(req),
        });

        LoggerContext.run(context, handleRequest);
      } else {
        handleRequest();
      }
    }
  }

  return LoggerMiddleware;
}

/**
 * Functional middleware for simpler setup
 *
 * @example
 * // main.ts
 * const logger = createLogger({ service: "my-app" });
 * app.use(nestMiddleware(logger));
 */
export function nestMiddleware(
  logger: Logger,
  options: NestMiddlewareOptions = {}
): (req: NestRequest, res: NestResponse, next: NestNextFunction) => void {
  const opts: Required<NestMiddlewareOptions> = { ...DEFAULT_OPTIONS, ...options };

  return (req: NestRequest, res: NestResponse, next: NestNextFunction) => {
    const path = getPath(req);

    if (shouldExcludePath(path, opts.excludePaths)) {
      return next();
    }

    if (opts.skip(req, res)) {
      return next();
    }

    let correlationId = getHeader(req.headers, opts.correlationIdHeader);
    if (!correlationId) {
      correlationId = getHeader(req.headers, "x-request-id") ?? opts.generateCorrelationId();
    }

    res.setHeader(opts.correlationIdHeader, correlationId);

    const startTime = Date.now();
    req.startTime = startTime;
    req.correlationId = correlationId;
    req.requestId = correlationId;

    const requestLogger = logger.child({
      correlationId,
      method: req.method,
      path,
    });
    req.logger = requestLogger;

    const handleRequest = (): void => {
      if (opts.logRequests) {
        const ctx: Bindings = { url: req.originalUrl ?? req.url };
        if (opts.includeQuery && req.query) {
          ctx.query = req.query;
        }
        if (opts.includeParams && req.params) {
          ctx.params = req.params;
        }
        requestLogger.info(opts.requestMessage(req), ctx);
      }

      res.on("finish", () => {
        if (opts.logResponses) {
          const duration = Date.now() - startTime;
          const level = getLogLevel(res.statusCode, opts);
          requestLogger[level](opts.responseMessage(req, res, duration), {
            statusCode: res.statusCode,
            duration,
          });
        }
      });

      next();
    };

    if (opts.useAsyncContext) {
      const context = createRequestContext({
        id: correlationId,
        correlationId,
        headers: req.headers,
        method: req.method,
        url: req.url,
        path,
        ip: getClientIp(req),
      });
      LoggerContext.run(context, handleRequest);
    } else {
      handleRequest();
    }
  };
}

/**
 * Creates a NestJS interceptor for request logging
 *
 * Interceptors provide more context than middleware (handler info, etc.)
 *
 * @example
 * // app.module.ts
 * import { Module } from "@nestjs/common";
 * import { APP_INTERCEPTOR } from "@nestjs/core";
 * import { createLogger } from "cenglu";
 * import { createNestInterceptor } from "cenglu/middleware";
 *
 * const logger = createLogger({ service: "my-app" });
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: APP_INTERCEPTOR,
 *       useValue: createNestInterceptor(logger),
 *     },
 *   ],
 * })
 * export class AppModule {}
 */
export function createNestInterceptor(
  logger: Logger,
  options: NestInterceptorOptions = {}
): {
  intercept(context: ExecutionContext, next: CallHandler): Observable<unknown>;
} {
  const opts = {
    ...DEFAULT_OPTIONS,
    includeHandler: true,
    includeController: true,
    ...options,
  };

  return {
    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep it like this for now
    intercept(context: ExecutionContext, next: CallHandler): Observable<unknown> {
      // Only handle HTTP requests
      if (context.getType() !== "http") {
        return next.handle();
      }

      const httpContext = context.switchToHttp();
      const req = httpContext.getRequest<NestRequest>();
      const res = httpContext.getResponse<NestResponse>();
      const path = getPath(req);

      if (shouldExcludePath(path, opts.excludePaths)) {
        return next.handle();
      }

      if (opts.skip(req, res)) {
        return next.handle();
      }

      const handler = context.getHandler();
      const controller = context.getClass();
      const handlerName = (handler as { name?: string })?.name ?? "unknown";
      const controllerName = (controller as { name?: string })?.name ?? "unknown";

      let correlationId = req.correlationId;
      if (!correlationId) {
        correlationId =
          getHeader(req.headers, opts.correlationIdHeader) ??
          getHeader(req.headers, "x-request-id") ??
          opts.generateCorrelationId();
        req.correlationId = correlationId;
        req.requestId = correlationId;
        res.setHeader(opts.correlationIdHeader, correlationId);
      }

      let requestLogger = req.logger;
      if (!requestLogger) {
        requestLogger = logger.child({
          correlationId,
          method: req.method,
          path,
        });
        req.logger = requestLogger;
      }
      if (opts.includeHandler || opts.includeController) {
        const handlerContext: Bindings = {};
        if (opts.includeController) {
          handlerContext.controller = controllerName;
        }
        if (opts.includeHandler) {
          handlerContext.handler = handlerName;
        }
        requestLogger = requestLogger.child(handlerContext);
      }

      const startTime = req.startTime ?? Date.now();

      if (opts.logRequests) {
        const ctx: Bindings = {
          controller: controllerName,
          handler: handlerName,
        };
        if (opts.includeQuery && req.query) {
          ctx.query = req.query;
        }
        if (opts.includeParams && req.params) {
          ctx.params = req.params;
        }
        requestLogger.info(opts.requestMessage(req), ctx);
      }

      return {
        pipe(...operators: unknown[]): Observable<unknown> {
          const source = next.handle();

          // Apply operators and add our tap
          let result = source;
          for (const op of operators) {
            if (typeof op === "function") {
              result = (op as (obs: Observable<unknown>) => Observable<unknown>)(result);
            }
          }

          // Log on complete
          return {
            ...result,
            subscribe(observer: {
              next?: (value: unknown) => void;
              error?: (err: unknown) => void;
              complete?: () => void;
            }) {
              return result.subscribe({
                next: observer.next,
                error: (err) => {
                  if (opts.logResponses) {
                    const duration = Date.now() - startTime;
                    requestLogger.error(
                      opts.responseMessage(req, res, duration),
                      err instanceof Error ? err : new Error(String(err)),
                      { statusCode: res.statusCode || 500, duration }
                    );
                  }
                  observer.error?.(err);
                },
                complete: () => {
                  if (opts.logResponses) {
                    const duration = Date.now() - startTime;
                    const level = getLogLevel(res.statusCode, opts);
                    requestLogger[level](opts.responseMessage(req, res, duration), {
                      statusCode: res.statusCode,
                      duration,
                      controller: controllerName,
                      handler: handlerName,
                    });
                  }
                  observer.complete?.();
                },
              });
            },
          };
        },
        subscribe(observer: {
          next?: (value: unknown) => void;
          error?: (err: unknown) => void;
          complete?: () => void;
        }) {
          return next.handle().subscribe({
            next: observer.next,
            error: (err) => {
              if (opts.logResponses) {
                const duration = Date.now() - startTime;
                requestLogger.error(
                  opts.responseMessage(req, res, duration),
                  err instanceof Error ? err : new Error(String(err)),
                  { statusCode: res.statusCode || 500, duration }
                );
              }
              observer.error?.(err);
            },
            complete: () => {
              if (opts.logResponses) {
                const duration = Date.now() - startTime;
                const level = getLogLevel(res.statusCode, opts);
                requestLogger[level](opts.responseMessage(req, res, duration), {
                  statusCode: res.statusCode,
                  duration,
                });
              }
              observer.complete?.();
            },
          });
        },
      };
    },
  };
}

export interface HttpException extends Error {
  getStatus(): number;
  getResponse(): string | object;
}

export type ArgumentsHost = {
  switchToHttp(): {
    getRequest<T = NestRequest>(): T;
    getResponse<T = NestResponse>(): T;
    getNext<T = NestNextFunction>(): T;
  };
  getType(): string;
};

/**
 * Creates a NestJS exception filter for logging errors
 *
 * @example
 * // app.module.ts
 * import { Module } from "@nestjs/common";
 * import { APP_FILTER } from "@nestjs/core";
 * import { createLogger } from "cenglu";
 * import { createNestExceptionFilter } from "cenglu/middleware";
 *
 * const logger = createLogger({ service: "my-app" });
 *
 * @Module({
 *   providers: [
 *     {
 *       provide: APP_FILTER,
 *       useValue: createNestExceptionFilter(logger),
 *     },
 *   ],
 * })
 * export class AppModule {}
 */
export function createNestExceptionFilter(
  logger: Logger,
  options: {
    /**
     * Include stack trace in response
     * @default false in production
     */
    includeStack?: boolean;

    /**
     * Custom error response formatter
     */
    formatResponse?: (exception: Error, req: NestRequest) => unknown;

    /**
     * Log 4xx errors
     * @default true
     */
    logClientErrors?: boolean;

    /**
     * Log 5xx errors
     * @default true
     */
    logServerErrors?: boolean;
  } = {}
): {
  catch(exception: Error | HttpException, host: ArgumentsHost): void;
} {
  const {
    includeStack = process.env.NODE_ENV !== "production",
    formatResponse,
    logClientErrors = true,
    logServerErrors = true,
  } = options;

  return {
    catch(exception: Error | HttpException, host: ArgumentsHost): void {
      if (host.getType() !== "http") {
        throw exception;
      }

      const ctx = host.switchToHttp();
      const req = ctx.getRequest<NestRequest>();
      const res = ctx.getResponse<
        NestResponse & { status(code: number): NestResponse; json(body: unknown): void }
      >();

      // Determine status code
      const status =
        typeof (exception as HttpException).getStatus === "function"
          ? (exception as HttpException).getStatus()
          : 500;

      const isClientError = status >= 400 && status < 500;
      const isServerError = status >= 500;

      const requestLogger = req.logger ?? logger;

      if ((isClientError && logClientErrors) || (isServerError && logServerErrors)) {
        const level = isServerError ? "error" : "warn";
        requestLogger[level]("Request exception", exception, {
          statusCode: status,
          path: getPath(req),
          method: req.method,
          correlationId: req.correlationId,
        });
      }

      const errorResponse = formatResponse
        ? formatResponse(exception, req)
        : {
            statusCode: status,
            message: exception.message,
            error: exception.name,
            ...(includeStack && { stack: exception.stack }),
            correlationId: req.correlationId,
            timestamp: new Date().toISOString(),
            path: getPath(req),
          };

      res.status(status);
      res.json(errorResponse);
    },
  };
}

/**
 * Property decorator to inject logger into controller/service
 *
 * Note: This requires the logger to be available in the DI container.
 * Use NestLoggerModule for proper DI setup.
 *
 * @example
 * @Controller("users")
 * export class UsersController {
 *   @InjectLogger()
 *   private readonly logger: Logger;
 *
 *   @Get()
 *   findAll() {
 *     this.logger.info("Finding all users");
 *   }
 * }
 */
export function createInjectLoggerDecorator(logger: Logger): () => PropertyDecorator {
  return () => {
    return (target: object, propertyKey: string | symbol) => {
      const contextName = (target.constructor as { name?: string }).name ?? "Unknown";

      Object.defineProperty(target, propertyKey, {
        get() {
          // Create child logger with context name
          return logger.child({ context: contextName });
        },
        enumerable: true,
        configurable: true,
      });
    };
  };
}

/**
 * Method decorator to log method calls
 *
 * @example
 * @Controller("users")
 * export class UsersController {
 *   constructor(private readonly logger: Logger) {}
 *
 *   @LogMethod()
 *   @Get(":id")
 *   findOne(@Param("id") id: string) {
 *     return this.userService.findOne(id);
 *   }
 * }
 */
export function createLogMethodDecorator(
  logger: Logger,
  options: {
    logArgs?: boolean;
    logResult?: boolean;
    logDuration?: boolean;
  } = {}
): (message?: string) => MethodDecorator {
  const { logArgs = false, logResult = false, logDuration = true } = options;

  return (message?: string) =>
    (target: object, propertyKey: string | symbol, descriptor: PropertyDescriptor) => {
      const originalMethod = descriptor.value;
      const methodName = String(propertyKey);
      const className = (target.constructor as { name?: string }).name ?? "Unknown";
      const logMessage = message ?? `${className}.${methodName}`;

      // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: keep it list this for now
      descriptor.value = async function (...args: unknown[]) {
        const methodLogger = logger.child({
          class: className,
          method: methodName,
        });

        const context: Bindings = {};
        if (logArgs && args.length > 0) {
          context.args = args;
        }

        const startTime = Date.now();
        methodLogger.debug(`${logMessage} started`, context);

        try {
          const result = await originalMethod.apply(this, args);

          const duration = Date.now() - startTime;
          const resultContext: Bindings = {};
          if (logDuration) {
            resultContext.duration = duration;
          }
          if (logResult && result !== undefined) {
            resultContext.result = result;
          }

          methodLogger.debug(`${logMessage} completed`, resultContext);
          return result;
        } catch (error) {
          const duration = Date.now() - startTime;
          methodLogger.error(
            `${logMessage} failed`,
            error instanceof Error ? error : new Error(String(error)),
            { duration }
          );
          throw error;
        }
      };

      return descriptor;
    };
}

export type NestLoggerModuleAsyncOptions = {
  /**
   * Whether to register as global module
   */
  isGlobal?: boolean;
  /**
   * Imports required for the factory
   */
  imports?: unknown[];
  /**
   * Factory function to create options
   */
  useFactory: (...args: unknown[]) => Promise<NestLoggerModuleOptions> | NestLoggerModuleOptions;
  /**
   * Dependencies to inject into factory
   */
  inject?: unknown[];
};

export const CENGLU_LOGGER: symbol = Symbol("CENGLU_LOGGER");
export const CENGLU_LOGGER_OPTIONS: symbol = Symbol("CENGLU_LOGGER_OPTIONS");
