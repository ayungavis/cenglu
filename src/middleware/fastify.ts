import { randomUUID } from "node:crypto";
import { createRequestContext, LoggerContext } from "../context";
import type { Logger } from "../logger";
import type { Bindings } from "../types";

export type FastifyRequest = {
  id: string;
  method: string;
  url: string;
  routerPath?: string;
  headers: Record<string, string | string[] | undefined>;
  query?: Record<string, unknown>;
  params?: Record<string, unknown>;
  body?: unknown;
  ip?: string;
  ips?: string[];
  hostname?: string;
  protocol?: string;

  // Added by plugin
  logger?: Logger;
  correlationId?: string;

  [key: string]: unknown;
};

export type FastifyReply = {
  statusCode: number;
  sent: boolean;

  header(name: string, value: string): FastifyReply;
  getHeader(name: string): string | undefined;
  getResponseTime(): number;

  [key: string]: unknown;
};

export type FastifyInstance = {
  addHook(
    name: "onRequest" | "onResponse" | "preHandler" | string,
    hook: (request: FastifyRequest, reply: FastifyReply) => Promise<void> | void
  ): FastifyInstance;
  addHook(
    name: "onError",
    hook: (request: FastifyRequest, reply: FastifyReply, error: Error) => Promise<void> | void
  ): FastifyInstance;
  addHook(name: string, hook: (...args: unknown[]) => Promise<void> | void): FastifyInstance;

  decorate(name: string, value: unknown): FastifyInstance;
  decorateRequest(name: string, value: unknown): FastifyInstance;
  decorateReply(name: string, value: unknown): FastifyInstance;

  [key: string]: unknown;
};

export type FastifyPluginOptions = {
  /**
   * The logger instance to use
   */
  logger: Logger;

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
  skip?: (request: FastifyRequest, reply: FastifyReply) => boolean;

  /**
   * Custom request message
   */
  requestMessage?: (request: FastifyRequest) => string;

  /**
   * Custom response message
   */
  responseMessage?: (request: FastifyRequest, reply: FastifyReply, duration: number) => string;

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
};

const DEFAULT_OPTIONS = {
  logRequests: true,
  logResponses: true,
  includeHeaders: false,
  includeQuery: true,
  includeBody: false,
  correlationIdHeader: "x-correlation-id",
  generateCorrelationId: randomUUID,
  ignorePaths: [] as (string | RegExp)[],
  skip: () => false,
  requestMessage: (request: FastifyRequest) =>
    `${request.method} ${request.routerPath || request.url}`,
  responseMessage: (request: FastifyRequest, reply: FastifyReply, duration: number) =>
    `${request.method} ${request.routerPath || request.url} ${reply.statusCode} ${duration}ms`,
  redactHeaders: ["authorization", "cookie", "set-cookie"],
  useAsyncContext: true,
};

function getHeader(
  headers: Record<string, string | string[] | undefined>,
  name: string
): string | undefined {
  const value = headers[name] ?? headers[name.toLowerCase()];
  return Array.isArray(value) ? value[0] : value;
}

function shouldIgnorePath(path: string | undefined, patterns?: (string | RegExp)[]): boolean {
  if (!(path && patterns) || patterns.length === 0) {
    return false;
  }

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
 * Create a Fastify plugin for request logging and context propagation
 *
 * @example
 * import Fastify from "fastify";
 * import { createLogger } from "cenglu";
 * import { fastifyPlugin } from "cenglu/middleware";
 *
 * const fastify = Fastify();
 * const logger = createLogger({ service: "api" });
 *
 * fastify.register(fastifyPlugin, {
 *   logger,
 *   ignorePaths: ["/health"],
 * });
 *
 * fastify.get("/users/:id", async (request, reply) => {
 *   request.logger.info("Fetching user");
 *   return { id: request.params.id };
 * });
 */
export function fastifyPlugin(
  fastify: FastifyInstance,
  options: FastifyPluginOptions,
  done: (err?: Error) => void
): void {
  const opts: Required<FastifyPluginOptions> = { ...DEFAULT_OPTIONS, ...options };
  const { logger } = opts;

  // Decorate request with logger and correlationId
  fastify.decorateRequest("logger", null);
  fastify.decorateRequest("correlationId", "");

  // Store for tracking request start times (outside AsyncLocalStorage)
  const requestTimes: WeakMap<FastifyRequest, number> = new WeakMap<FastifyRequest, number>();

  // onRequest hook - runs first
  // biome-ignore lint/suspicious/useAwait: async: fastify hooks can be sync or async
  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: needed for logic
  fastify.addHook("onRequest", async (request: FastifyRequest, reply: FastifyReply) => {
    // Check if we should skip
    const path: string | undefined = request.routerPath || request.url.split("?")[0];
    if (shouldIgnorePath(path, opts.ignorePaths)) {
      return;
    }

    if (opts.skip(request, reply)) {
      return;
    }

    // Extract or generate correlation ID
    let correlationId: string | undefined = getHeader(request.headers, opts.correlationIdHeader);

    if (!correlationId) {
      correlationId =
        getHeader(request.headers, "x-request-id") ?? request.id ?? opts.generateCorrelationId();
    }

    // Set correlation ID on reply
    reply.header(opts.correlationIdHeader, correlationId);

    // Store start time
    requestTimes.set(request, Date.now());

    // Attach to request
    request.correlationId = correlationId;

    // Create child logger
    const requestLogger: Logger = logger.child({
      correlationId,
      method: request.method,
      path,
    });
    request.logger = requestLogger;

    // Log request
    if (opts.logRequests) {
      const requestData: Bindings = {
        url: request.url,
      };

      if (opts.includeQuery && request.query && Object.keys(request.query).length > 0) {
        requestData.query = request.query;
      }

      if (opts.includeHeaders) {
        requestData.headers = sanitizeHeaders(request.headers, opts.redactHeaders);
      }

      if (opts.includeBody && request.body !== undefined) {
        requestData.body = request.body;
      }

      if (request.params && Object.keys(request.params).length > 0) {
        requestData.params = request.params;
      }

      requestLogger.info(opts.requestMessage(request), requestData);
    }

    // Set up AsyncLocalStorage context
    if (opts.useAsyncContext) {
      const context = createRequestContext({
        id: correlationId,
        correlationId,
        headers: request.headers,
        method: request.method,
        url: request.url,
        path,
        ip: request.ip,
      });

      LoggerContext.enter(context);
    }
  });

  // onResponse hook - runs after response is sent
  // biome-ignore lint/suspicious/useAwait: async: fastify hooks can be sync or async
  fastify.addHook("onResponse", async (request: FastifyRequest, reply: FastifyReply) => {
    // Check if we should skip
    const path: string | undefined = request.routerPath || request.url.split("?")[0];
    if (shouldIgnorePath(path, opts.ignorePaths)) {
      return;
    }

    if (opts.skip(request, reply)) {
      return;
    }

    // Log response
    if (opts.logResponses && request.logger) {
      const startTime: number | undefined = requestTimes.get(request);
      const duration: number = startTime ? Date.now() - startTime : reply.getResponseTime();
      const level: "info" | "warn" | "error" = getLogLevel(reply.statusCode);

      request.logger[level](opts.responseMessage(request, reply, duration), {
        statusCode: reply.statusCode,
        duration,
      });
    }
  });

  // onError hook - runs when a route throws
  // biome-ignore lint/suspicious/useAwait: async: fastify hooks can be sync or async
  fastify.addHook("onError", async (request: FastifyRequest, reply: FastifyReply, error: Error) => {
    if (request.logger) {
      request.logger.error("Request error", error, {
        statusCode: reply.statusCode,
      });
    }
  });

  done();
}

export const createFastifyPlugin: typeof fastifyPlugin = fastifyPlugin;

// Add fastify-plugin metadata
(fastifyPlugin as unknown as { [key: symbol]: unknown })[Symbol.for("skip-override")] = true;
(fastifyPlugin as unknown as { [key: string]: unknown })["fastify-plugin"] = {
  fastify: "4.x",
  name: "cenglu-logger",
};
