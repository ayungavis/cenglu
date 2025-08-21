import { randomUUID } from "node:crypto";
import type { Logger } from "./logger";

/**
 * Express middleware for request logging and context
 */
export function expressMiddleware(
  logger: Logger,
  options: {
    logRequests?: boolean;
    logResponses?: boolean;
    includeHeaders?: boolean;
    includeBody?: boolean;
    correlationIdHeader?: string;
    generateCorrelationId?: () => string;
    skip?: (req: any, res: any) => boolean;
  } = {},
) {
  const {
    logRequests = true,
    logResponses = true,
    includeHeaders = false,
    includeBody = false,
    correlationIdHeader = "x-correlation-id",
    generateCorrelationId = randomUUID,
    skip,
  } = options;

  return (req: any, res: any, next: any) => {
    // Skip if configured
    if (skip?.(req, res)) {
      return next();
    }

    // Get or generate correlation ID
    const correlationId =
      req.headers[correlationIdHeader] ||
      req.headers["x-request-id"] ||
      generateCorrelationId();

    // Add correlation ID to request and response
    req.correlationId = correlationId;
    res.setHeader(correlationIdHeader, correlationId);

    // Create child logger with request context
    const requestLogger = logger.child({
      correlationId,
      method: req.method,
      url: req.url,
      path: req.path,
      ip: req.ip || req.connection?.remoteAddress,
      userAgent: req.headers["user-agent"],
    });

    // Attach logger to request
    req.logger = requestLogger;

    // Log request if configured
    if (logRequests) {
      const requestData: Record<string, unknown> = {
        method: req.method,
        url: req.url,
        query: req.query,
      };

      if (includeHeaders) {
        requestData.headers = req.headers;
      }

      if (includeBody && req.body) {
        requestData.body = req.body;
      }

      requestLogger.info("Incoming request", requestData);
    }

    // Capture response data
    if (logResponses) {
      const startTime = Date.now();
      const originalSend = res.send;

      res.send = function (data: any) {
        res.send = originalSend;

        const duration = Date.now() - startTime;
        const responseData: Record<string, unknown> = {
          statusCode: res.statusCode,
          duration,
        };

        if (includeBody && data) {
          try {
            responseData.body =
              typeof data === "string"
                ? data.length > 1000
                  ? `${data.substring(0, 1000)}...`
                  : data
                : data;
          } catch {}
        }

        if (res.statusCode >= 400) {
          requestLogger.error("Request failed", responseData);
        } else {
          requestLogger.info("Request completed", responseData);
        }

        return originalSend.call(this, data);
      };
    }

    next();
  };
}

/**
 * Fastify plugin for request logging and context
 */
export function fastifyPlugin(
  fastify: any,
  options: {
    logger: Logger;
    logRequests?: boolean;
    logResponses?: boolean;
    includeHeaders?: boolean;
    includeBody?: boolean;
    correlationIdHeader?: string;
    generateCorrelationId?: () => string;
    skip?: (req: any, reply: any) => boolean;
  },
  done: () => void,
) {
  const {
    logger,
    logRequests = true,
    logResponses = true,
    includeHeaders = false,
    includeBody = false,
    correlationIdHeader = "x-correlation-id",
    generateCorrelationId = randomUUID,
    skip,
  } = options;

  // Add request hook
  fastify.addHook("onRequest", async (request: any, reply: any) => {
    // Skip if configured
    if (skip?.(request, reply)) {
      return;
    }

    // Get or generate correlation ID
    const correlationId =
      request.headers[correlationIdHeader] ||
      request.headers["x-request-id"] ||
      generateCorrelationId();

    // Add correlation ID to request and reply
    request.correlationId = correlationId;
    reply.header(correlationIdHeader, correlationId);

    // Create child logger with request context
    const requestLogger = logger.child({
      correlationId,
      method: request.method,
      url: request.url,
      path: request.routerPath,
      ip: request.ip,
      userAgent: request.headers["user-agent"],
    });

    // Attach logger to request
    request.logger = requestLogger;

    // Log request if configured
    if (logRequests) {
      const requestData: Record<string, unknown> = {
        method: request.method,
        url: request.url,
        query: request.query,
      };

      if (includeHeaders) {
        requestData.headers = request.headers;
      }

      if (includeBody && request.body) {
        requestData.body = request.body;
      }

      requestLogger.info("Incoming request", requestData);
    }
  });

  // Add response hook
  if (logResponses) {
    fastify.addHook("onResponse", async (request: any, reply: any) => {
      if (skip?.(request, reply)) {
        return;
      }

      const responseData: Record<string, unknown> = {
        statusCode: reply.statusCode,
        duration: reply.getResponseTime(),
      };

      if (reply.statusCode >= 400) {
        request.logger.error("Request failed", responseData);
      } else {
        request.logger.info("Request completed", responseData);
      }
    });
  }

  done();
}

/**
 * Koa middleware for request logging and context
 */
export function koaMiddleware(
  logger: Logger,
  options: {
    logRequests?: boolean;
    logResponses?: boolean;
    includeHeaders?: boolean;
    includeBody?: boolean;
    correlationIdHeader?: string;
    generateCorrelationId?: () => string;
    skip?: (ctx: any) => boolean;
  } = {},
) {
  const {
    logRequests = true,
    logResponses = true,
    includeHeaders = false,
    includeBody = false,
    correlationIdHeader = "x-correlation-id",
    generateCorrelationId = randomUUID,
    skip,
  } = options;

  return async (ctx: any, next: any) => {
    // Skip if configured
    if (skip?.(ctx)) {
      return next();
    }

    // Get or generate correlation ID
    const correlationId =
      ctx.headers[correlationIdHeader] ||
      ctx.headers["x-request-id"] ||
      generateCorrelationId();

    // Add correlation ID to context
    ctx.correlationId = correlationId;
    ctx.set(correlationIdHeader, correlationId);

    // Create child logger with request context
    const requestLogger = logger.child({
      correlationId,
      method: ctx.method,
      url: ctx.url,
      path: ctx.path,
      ip: ctx.ip,
      userAgent: ctx.headers["user-agent"],
    });

    // Attach logger to context
    ctx.logger = requestLogger;

    // Log request if configured
    if (logRequests) {
      const requestData: Record<string, unknown> = {
        method: ctx.method,
        url: ctx.url,
        query: ctx.query,
      };

      if (includeHeaders) {
        requestData.headers = ctx.headers;
      }

      if (includeBody && ctx.request.body) {
        requestData.body = ctx.request.body;
      }

      requestLogger.info("Incoming request", requestData);
    }

    const startTime = Date.now();

    try {
      await next();
    } catch (error) {
      const duration = Date.now() - startTime;
      requestLogger.error(
        "Request error",
        {
          statusCode: ctx.status || 500,
          duration,
        },
        error,
      );
      throw error;
    }

    // Log response if configured
    if (logResponses) {
      const duration = Date.now() - startTime;
      const responseData: Record<string, unknown> = {
        statusCode: ctx.status,
        duration,
      };

      if (includeBody && ctx.body) {
        try {
          responseData.body =
            typeof ctx.body === "string"
              ? ctx.body.length > 1000
                ? `${ctx.body.substring(0, 1000)}...`
                : ctx.body
              : ctx.body;
        } catch {}
      }

      if (ctx.status >= 400) {
        requestLogger.error("Request failed", responseData);
      } else {
        requestLogger.info("Request completed", responseData);
      }
    }
  };
}

/**
 * Create a correlation ID generator using different strategies
 */
export function createCorrelationIdGenerator(
  strategy: "uuid" | "timestamp" | "custom" = "uuid",
  customGenerator?: () => string,
) {
  switch (strategy) {
    case "uuid":
      return randomUUID;
    case "timestamp":
      return () => `${Date.now()}-${Math.random().toString(36).substr(2, 9)}`;
    case "custom":
      if (!customGenerator) {
        throw new Error(
          "Custom generator function required for custom strategy",
        );
      }
      return customGenerator;
    default:
      return randomUUID;
  }
}
