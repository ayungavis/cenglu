import { AsyncLocalStorage } from "node:async_hooks";
import crypto from "node:crypto";
import type { Bindings } from "./types";

export type LogContext = {
  bindings: Bindings;
  correlationId?: string;
  traceId?: string;
  spanId?: string;
  userId?: string;
  requestId?: string;
  sessionId?: string;
  tenantId?: string;
  [key: string]: unknown;
};

const asyncLocalStorage = new AsyncLocalStorage<LogContext>();

/**
 * Logger context management using AsyncLocalStorage
 *
 * Provides automatic context propagation across async operations,
 * eliminating the need to manually pass context through function calls.
 *
 * @example
 * // In middleware - set up context for the request
 * app.use((req, res, next) => {
 *   LoggerContext.run(
 *     {
 *       correlationId: req.headers['x-correlation-id'] || generateId(),
 *       bindings: { path: req.path, method: req.method }
 *     },
 *     () => next()
 *   );
 * });
 *
 * // Anywhere in your code - context is automatically available
 * async function processOrder(orderId: string) {
 *   // This log automatically includes correlationId, path, method
 *   logger.info("Processing order", { orderId });
 *
 *   // Add more context for this operation
 *   LoggerContext.addBindings({ orderId });
 *
 *   await chargePayment();
 *   await sendConfirmation();
 * }
 */
export const LoggerContext = {
  /**
   * Run a function within a new context
   *
   * The context is automatically inherited by all async operations
   * spawned within the function, including Promises, setTimeout, etc.
   *
   * @param context - Partial context to set (merged with parent)
   * @param fn - Function to run within the context
   * @returns The return value of the function
   *
   * @example
   * const result = LoggerContext.run(
   *   { correlationId: 'abc-123', bindings: { userId: 42 } },
   *   async () => {
   *     // All logs here will include correlationId and userId
   *     return await processRequest();
   *   }
   * );
   */
  run<T>(context: Partial<LogContext>, fn: () => T): T {
    const parent = asyncLocalStorage.getStore();
    const merged = mergeContext(parent, context);
    return asyncLocalStorage.run(merged, fn);
  },

  runAsync<T>(context: Partial<LogContext>, fn: () => Promise<T>): Promise<T> {
    return this.run(context, fn);
  },

  runIsolated<T>(context: Partial<LogContext>, fn: () => T): T {
    const fresh: LogContext = {
      bindings: {},
      ...context,
    };
    return asyncLocalStorage.run(fresh, fn);
  },

  enter(context: Partial<LogContext>): void {
    const parent = asyncLocalStorage.getStore();
    const merged = mergeContext(parent, context);
    asyncLocalStorage.enterWith(merged);
  },

  get(): LogContext | undefined {
    return asyncLocalStorage.getStore();
  },

  getBindings(): Bindings {
    return asyncLocalStorage.getStore()?.bindings ?? {};
  },

  getCorrelationId(): string | undefined {
    return asyncLocalStorage.getStore()?.correlationId;
  },

  getTraceId(): string | undefined {
    return asyncLocalStorage.getStore()?.traceId;
  },

  getSpanId(): string | undefined {
    return asyncLocalStorage.getStore()?.spanId;
  },

  getUserId(): string | undefined {
    return asyncLocalStorage.getStore()?.userId;
  },

  getRequestId(): string | undefined {
    return asyncLocalStorage.getStore()?.requestId;
  },

  getTenantId(): string | undefined {
    return asyncLocalStorage.getStore()?.tenantId;
  },

  getValue<T = unknown>(key: string): T | undefined {
    const store = asyncLocalStorage.getStore();
    if (!store) {
      return;
    }

    if (key === "bindings") {
      return store.bindings as T;
    }

    // Check top-level first
    if (key in store) {
      return store[key] as T;
    }

    // Check bindings
    return store.bindings[key] as T;
  },

  set(key: string, value: unknown): void {
    const store = asyncLocalStorage.getStore();
    if (!store) {
      return; // Not in a context, silently ignore
    }

    // Handle special keys
    switch (key) {
      case "correlationId":
      case "traceId":
      case "spanId":
      case "userId":
      case "requestId":
      case "sessionId":
      case "tenantId":
        store[key] = value as string;
        break;
      case "bindings":
        if (typeof value === "object" && value !== null) {
          store.bindings = { ...store.bindings, ...(value as Bindings) };
        }
        break;
      default:
        // Add to bindings
        store.bindings = { ...store.bindings, [key]: value };
    }
  },

  addBindings(bindings: Bindings): void {
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.bindings = { ...store.bindings, ...bindings };
    }
  },

  removeBinding(key: string): void {
    const store = asyncLocalStorage.getStore();
    if (store && key in store.bindings) {
      const { [key]: _, ...rest } = store.bindings;
      store.bindings = rest;
    }
  },

  setCorrelationId(id: string): void {
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.correlationId = id;
    }
  },

  setUserId(id: string): void {
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.userId = id;
    }
  },

  setTraceContext(traceId: string, spanId?: string): void {
    const store = asyncLocalStorage.getStore();
    if (store) {
      store.traceId = traceId;
      if (spanId) {
        store.spanId = spanId;
      }
    }
  },

  isActive(): boolean {
    return asyncLocalStorage.getStore() !== undefined;
  },

  hasBinding(key: string): boolean {
    const store = asyncLocalStorage.getStore();
    return store ? key in store.bindings : false;
  },

  snapshot(): LogContext | undefined {
    const store = asyncLocalStorage.getStore();
    if (!store) {
      return;
    }

    return {
      ...store,
      bindings: { ...store.bindings },
    };
  },

  restore<T>(snapshot: LogContext | undefined, fn: () => T): T {
    if (!snapshot) {
      return fn();
    }
    return asyncLocalStorage.run(snapshot, fn);
  },

  /**
   * Create a bound function that preserves the current context
   *
   * Useful when passing callbacks to libraries that don't
   * automatically preserve async context
   *
   * @param fn - Function to bind
   * @returns Bound function that runs with the captured context
   *
   * @example
   * const boundCallback = LoggerContext.bind(() => {
   *   logger.info("This runs with the original context");
   * });
   *
   * // Pass to a library that doesn't preserve context
   * someLibrary.onEvent(boundCallback);
   */
  bind<TArgs extends unknown[], TReturn>(
    fn: (...args: TArgs) => TReturn
  ): (...args: TArgs) => TReturn {
    const snapshot = this.snapshot();

    return (...args: TArgs): TReturn => this.restore(snapshot, () => fn(...args));
  },

  bindAll<T extends Record<string, (...args: unknown[]) => unknown>>(obj: T): T {
    const result = {} as T;

    for (const key of Object.keys(obj) as (keyof T)[]) {
      const fn = obj[key];
      if (typeof fn === "function") {
        result[key] = this.bind(fn as (...args: unknown[]) => unknown) as T[keyof T];
      }
    }

    return result;
  },

  disable(): void {
    asyncLocalStorage.disable();
  },

  getStore(): AsyncLocalStorage<LogContext> {
    return asyncLocalStorage;
  },
};

// biome-ignore lint/complexity/noExcessiveCognitiveComplexity: needed for merging logic
function mergeContext(parent: LogContext | undefined, updates: Partial<LogContext>): LogContext {
  const merged: LogContext = {
    bindings: {
      ...(parent?.bindings || {}),
      ...(updates.bindings || {}),
    },
  };

  // Copy parent values first
  if (parent) {
    if (parent.correlationId) {
      merged.correlationId = parent.correlationId;
    }
    if (parent.traceId) {
      merged.traceId = parent.traceId;
    }
    if (parent.spanId) {
      merged.spanId = parent.spanId;
    }
    if (parent.userId) {
      merged.userId = parent.userId;
    }
    if (parent.requestId) {
      merged.requestId = parent.requestId;
    }
    if (parent.sessionId) {
      merged.sessionId = parent.sessionId;
    }
    if (parent.tenantId) {
      merged.tenantId = parent.tenantId;
    }

    // Copy any custom fields
    for (const key of Object.keys(parent)) {
      if (!(key in merged) && key !== "bindings") {
        merged[key] = parent[key];
      }
    }
  }

  // Apply updates (override parent values)
  if (updates.correlationId !== undefined) {
    merged.correlationId = updates.correlationId;
  }
  if (updates.traceId !== undefined) {
    merged.traceId = updates.traceId;
  }
  if (updates.spanId !== undefined) {
    merged.spanId = updates.spanId;
  }
  if (updates.userId !== undefined) {
    merged.userId = updates.userId;
  }
  if (updates.requestId !== undefined) {
    merged.requestId = updates.requestId;
  }
  if (updates.sessionId !== undefined) {
    merged.sessionId = updates.sessionId;
  }
  if (updates.tenantId !== undefined) {
    merged.tenantId = updates.tenantId;
  }

  // Copy any custom fields from updates
  for (const key of Object.keys(updates)) {
    if (!(key in merged) && key !== "bindings") {
      merged[key] = updates[key];
    }
  }

  return merged;
}

function getHeader(
  headers: Record<string, string | string[] | undefined> | undefined,
  name: string
): string | undefined {
  if (!headers) {
    return;
  }

  // Try exact match first
  let value = headers[name];

  // Try lowercase
  if (value === undefined) {
    value = headers[name.toLowerCase()];
  }

  // Handle array values
  if (Array.isArray(value)) {
    return value[0];
  }

  return value;
}

export type RequestContextOptions = {
  id?: string;
  correlationId?: string;
  headers?: Record<string, string | string[] | undefined>;
  method?: string;
  url?: string;
  path?: string;
  ip?: string;
  userAgent?: string;
  userId?: string;
  sessionId?: string;
  tenantId?: string;
  bindings?: Bindings;
};

/**
 * Create context from an HTTP request
 *
 * Extracts common values from request headers and creates
 * a context suitable for request logging.
 *
 * @param options - Request information
 * @returns Partial context to use with LoggerContext.run()
 *
 * @example
 * app.use((req, res, next) => {
 *   const context = createRequestContext({
 *     id: req.id,
 *     headers: req.headers,
 *     method: req.method,
 *     url: req.url,
 *     ip: req.ip,
 *   });
 *
 *   LoggerContext.run(context, () => next());
 * });
 */

export function createRequestContext(options: RequestContextOptions): Partial<LogContext> {
  const headers = options.headers;

  // Extract correlation ID from headers or use provided values
  const correlationId =
    options.correlationId ??
    options.id ??
    getHeader(headers, "x-correlation-id") ??
    getHeader(headers, "x-request-id") ??
    getHeader(headers, "request-id");

  // Extract trace context from headers
  const traceId =
    getHeader(headers, "x-trace-id") ??
    extractTraceIdFromTraceParent(getHeader(headers, "traceparent"));

  const spanId =
    getHeader(headers, "x-span-id") ??
    extractSpanIdFromTraceParent(getHeader(headers, "traceparent"));

  // Build bindings from request info
  const bindings: Bindings = {};

  if (options.method) {
    bindings.method = options.method;
  }
  if (options.path) {
    bindings.path = options.path;
  } else if (options.url) {
    bindings.path = extractPath(options.url);
  }
  if (options.ip) {
    bindings.ip = options.ip;
  }
  if (options.userAgent) {
    bindings.userAgent = options.userAgent;
  } else if (headers) {
    const ua = getHeader(headers, "user-agent");
    if (ua) {
      bindings.userAgent = ua;
    }
  }

  // Add any additional bindings
  if (options.bindings) {
    Object.assign(bindings, options.bindings);
  }

  const context: Partial<LogContext> = {
    bindings,
  };

  if (correlationId) {
    context.correlationId = correlationId;
  }
  if (traceId) {
    context.traceId = traceId;
  }
  if (spanId) {
    context.spanId = spanId;
  }
  if (options.id) {
    context.requestId = options.id;
  }
  if (options.userId) {
    context.userId = options.userId;
  }
  if (options.sessionId) {
    context.sessionId = options.sessionId;
  }
  if (options.tenantId) {
    context.tenantId = options.tenantId;
  }

  return context;
}

function extractTraceIdFromTraceParent(traceparent: string | undefined): string | undefined {
  if (!traceparent) {
    return;
  }

  const parts = traceparent.split("-");
  if (parts.length >= 2) {
    return parts[1];
  }

  return;
}

function extractSpanIdFromTraceParent(traceparent: string | undefined): string | undefined {
  if (!traceparent) {
    return;
  }

  const parts = traceparent.split("-");
  if (parts.length >= 3) {
    return parts[2];
  }

  return;
}

function extractPath(url: string): string {
  try {
    // Handle relative URLs
    if (url.startsWith("/")) {
      const queryIndex = url.indexOf("?");
      return queryIndex >= 0 ? url.slice(0, queryIndex) : url;
    }

    // Handle absolute URLs
    const parsed = new URL(url);
    return parsed.pathname;
  } catch {
    return url;
  }
}

export type CorrelationIdStrategy = "uuid" | "ulid" | "nanoid" | "timestamp" | "custom";

export type CorrelationIdOptions = {
  strategy?: CorrelationIdStrategy;
  prefix?: string;
  generator?: () => string;
};

/**
 * Create a correlation ID generator
 *
 * @param options - Generator options
 * @returns Function that generates correlation IDs
 *
 * @example
 * const generateId = createCorrelationIdGenerator({
 *   strategy: "uuid",
 *   prefix: "req-",
 * });
 *
 * const id = generateId(); // "req-a1b2c3d4-..."
 */
export function createCorrelationIdGenerator(options: CorrelationIdOptions = {}): () => string {
  const { strategy = "uuid", prefix = "", generator } = options;

  switch (strategy) {
    case "uuid":
      return () => {
        const id = generateUUID();
        return prefix ? `${prefix}${id}` : id;
      };

    case "ulid":
      return () => {
        const id = generateULID();
        return prefix ? `${prefix}${id}` : id;
      };

    case "nanoid":
      return () => {
        const id = generateNanoId();
        return prefix ? `${prefix}${id}` : id;
      };

    case "timestamp":
      return () => {
        const id = `${Date.now()}-${Math.random().toString(36).slice(2, 11)}`;
        return prefix ? `${prefix}${id}` : id;
      };

    case "custom":
      if (!generator) {
        throw new Error("Custom generator function required for 'custom' strategy");
      }
      return () => {
        const id = generator();
        return prefix ? `${prefix}${id}` : id;
      };

    default:
      return () => {
        const id = generateUUID();
        return prefix ? `${prefix}${id}` : id;
      };
  }
}

function generateUUID(): string {
  try {
    if (typeof crypto.randomUUID === "function") {
      return crypto.randomUUID();
    }
  } catch {
    // Fallback below
  }

  // Fallback implementation
  return "xxxxxxxx-xxxx-4xxx-yxxx-xxxxxxxxxxxx".replace(/[xy]/g, (c) => {
    // biome-ignore lint/suspicious/noBitwiseOperators: needed for UUID generation
    const r = (Math.random() * 16) | 0;
    // biome-ignore lint/suspicious/noBitwiseOperators: needed for UUID generation
    const v = c === "x" ? r : (r & 0x3) | 0x8;
    return v.toString(16);
  });
}

function generateULID(): string {
  const CHARS = "0123456789ABCDEFGHJKMNPQRSTVWXYZ";

  // Timestamp component (10 chars)
  let now = Date.now();
  let timestamp = "";
  for (let i = 0; i < 10; i++) {
    timestamp = CHARS[now % 32] + timestamp;
    now = Math.floor(now / 32);
  }

  // Random component (16 chars)
  let random = "";
  for (let i = 0; i < 16; i++) {
    random += CHARS[Math.floor(Math.random() * 32)];
  }

  return timestamp + random;
}

function generateNanoId(size = 21): string {
  const CHARS = "0123456789ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz-_";
  let id = "";

  for (let i = 0; i < size; i++) {
    id += CHARS[Math.floor(Math.random() * 64)];
  }

  return id;
}

/**
 * Decorator to automatically wrap a method with context
 *
 * @example
 * class UserService {
 *   @withContext({ bindings: { service: 'UserService' } })
 *   async createUser(data: CreateUserDto) {
 *     logger.info("Creating user"); // Includes service: 'UserService'
 *   }
 * }
 */
export function withContext(
  context: Partial<LogContext>
): (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor {
  return (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: unknown[]) {
      return LoggerContext.run(context, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}

/**
 * Decorator to add bindings from method parameters
 *
 * @example
 * class OrderService {
 *   @withBindings((orderId: string) => ({ orderId }))
 *   async processOrder(orderId: string) {
 *     logger.info("Processing order"); // Includes orderId
 *   }
 * }
 */
export function withBindings<TArgs extends unknown[]>(
  extractBindings: (...args: TArgs) => Bindings
): (_target: unknown, _propertyKey: string, descriptor: PropertyDescriptor) => PropertyDescriptor {
  return (
    _target: unknown,
    _propertyKey: string,
    descriptor: PropertyDescriptor
  ): PropertyDescriptor => {
    const originalMethod = descriptor.value;

    descriptor.value = function (...args: TArgs) {
      const bindings = extractBindings(...args);
      return LoggerContext.run({ bindings }, () => originalMethod.apply(this, args));
    };

    return descriptor;
  };
}
