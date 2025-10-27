import { randomUUID } from "node:crypto";

import type {
  MiddlewareOptions,
  Request,
  Response,
} from "../types/middleware.type";

/**
 * Express middleware for logging HTTP requests and responses.
 *
 * @param logger - The logger instance to use for logging.
 * @param options - Configuration options for the middleware.
 * @returns An Express middleware function.
 *
 * @example
 * ```ts
 * import express from "express";
 * import { createLogger } from "your-logger-library";
 * import { expressMiddleware } from "your-middleware-library";
 *
 * const app = express();
 * const logger = createLogger({ /* logger config * / });
 *
 * app.use(
 *   expressMiddleware({
 *     logger,
 *     options: {
 *       logRequests: true,
 *       logResponses: true,
 *       includeHeaders: true,
 *       includeBody: false,
 *     },
 *   })
 * );
 *
 * app.get("/", (req, res) => {
 *   res.send("Hello, world!");
 * });
 *
 * app.listen(3000, () => {
 *   logger.info("Server is running on port 3000");
 * });
 * ```
 */
export function expressMiddleware<
  Req extends Request = any,
  Res extends Response = any,
  Next extends () => void = () => void,
>({ logger, options = {} }: MiddlewareOptions<Req, Res>) {
  const {
    logRequests = true,
    logResponses = true,
    includeHeaders = false,
    includeBody = false,
    correlationIdHeader = "x-correlation-id",
    generateCorrelationId = randomUUID,
    skip,
  } = options;

  return (req: Req, res: Res, next: Next) => {
    // Skip if configured
    if (skip?.(req, res)) {
      return next();
    }

    // Get or generate correlation ID
    const correlationId =
      req.headers?.[correlationIdHeader] ??
      req.headers?.["x-request-id"] ??
      generateCorrelationId();

    // Add correlation ID to request and response
    req.correlationid = correlationId;
    res.setHeader?.(correlationIdHeader, correlationId);

    // Create child logger with request context
    const requestLogger = logger.child({
      correlationId,
      method: req.method,
      url: req.url,
      path: req.path,
      ip: req.ip ?? req.connection?.remoteAddress,
      userAgent: req.headers?.["user-agent"],
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
    if (logResponses && res.send) {
      const startTime = Date.now();
      const originalSend = res.send;

      res.send = function (data: any): Response {
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

        if (res?.statusCode && res.statusCode >= 400) {
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
