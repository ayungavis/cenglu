import {
  datadogLine,
  ecsLine,
  jsonLine,
  prettyLine,
  splunkLine,
} from "./format";
import type { Redactor } from "./redaction";
import { ConsoleTransport } from "./transports/console";
import { FileTransport } from "./transports/file";
import type {
  Bindings,
  LoggerOptions,
  LogLevel,
  LogRecord,
  ProviderAdapter,
  Theme,
  Transport,
} from "./types";

const levelOrder: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

/**
 * A high-performance, zero-dependencies logging library for Node.js applications.
 *
 * The Logger class provides structured logging with built-in redaction, multiple output formats,
 * and support for various transports. It's designed for production use with performance optimizations
 * and developer-friendly features.
 *
 * @example
 * ```typescript
 * const logger = new Logger({
 *   level: 'info',
 *   service: 'my-app',
 *   pretty: { enabled: true }
 * });
 *
 * logger.info('Application started', { port: 3000 });
 * logger.error('Database connection failed', error);
 * ```
 */
export class Logger {
  private level: LogLevel;
  private bindings: Bindings;
  private transports: Transport[] = [];
  private adapters: ProviderAdapter[] = [];
  private pretty: {
    enabled: boolean;
    theme: Partial<Theme>;
    formatter?: (rec: LogRecord) => string;
  };
  private structured: {
    type: "json" | "ecs" | "datadog" | "splunk";
    map?: (rec: LogRecord) => unknown;
  };
  private sampling?: LoggerOptions["sampling"];
  private redactor?: Redactor;
  private correlationId?: string | (() => string);
  private service?: string;
  private env?: string;
  private version?: string;
  private now: () => number;
  private random: () => number;
  private traceProvider?: LoggerOptions["traceProvider"];

  constructor(opts: LoggerOptions = {}) {
    const envLevel = process.env.LOG_LEVEL as LogLevel | undefined;

    this.level =
      opts.level ??
      envLevel ??
      (process.env.NODE_ENV === "prodiction" ? "info" : "debug");

    this.bindings = { ...(opts.bindings || {}) };
    this.service = opts.service ?? process.env.SERVICE_NAME;
    this.env = opts.env ?? process.env.NODE_ENV;
    this.version = opts.version ?? process.env.SERVICE_VERSION;
    this.now = opts.now || (() => Date.now());
    this.random = opts.random ?? Math.random;
    this.traceProvider = opts.traceProvider;

    if (opts.console?.enabled ?? true) {
      this.transports.push(new ConsoleTransport());
    }

    const fileEnabled = opts.file?.enabled ?? process.env.LOG_TO_FILE === "1";
    if (fileEnabled) {
      const compressEnv = process.env.LOG_COMPRESS;
      const compress =
        compressEnv === "gzip" || compressEnv === "lz4"
          ? compressEnv
          : process.env.LOG_GZIP === "1"
            ? "gzip"
            : opts.file?.rotation?.compress;

      const rotation = {
        intervalDays: process.env.LOG_ROTATE_DAYS
          ? Number(process.env.LOG_ROTATE_DAYS)
          : opts.file?.rotation?.intervalDays,
        maxBytes: process.env.LOG_MAX_BYTES
          ? Number(process.env.LOG_MAX_BYTES)
          : opts.file?.rotation?.maxBytes,
        maxFilesPerPeriod: process.env.LOG_MAX_FILES
          ? Number(process.env.LOG_MAX_FILES)
          : opts.file?.rotation?.maxFilesPerPeriod,
        compress,
        compressedTtlDays: process.env.LOG_COMPRESS_TTL_DAYS
          ? Number(process.env.LOG_COMPRESS_TTL_DAYS)
          : opts.file?.rotation?.compressedTtlDays,
      };

      const fileOpts = {
        dir: process.env.LOG_DIR ?? opts.file?.dir,
        rotation,
        separateError: opts.file?.separateError,
        filename: opts.file?.filename,
        enabled: true,
      };

      this.transports.push(new FileTransport(fileOpts, this.now));
    }

    this.adapters = [...(opts.adapters || [])];
    this.pretty = {
      enabled: process.stdout.isTTY && process.env.NODE_ENV !== "production",
      theme: {},
      formatter: undefined,
      ...(opts.pretty || {}),
    };

    this.structured = { type: "json", ...(opts.structured || {}) };
    this.sampling = opts.sampling;

    // Initialize redactor ifredaction is enabled
    if (opts.redaction?.enabled !== false) {
      this.redactor = new Redactor(opts.redaction || {});
    }

    // Set correlation ID
    this.correlationId = opts.correlationId;
  }

  /**
   * Creates a child logger with additional context bindings.
   *
   * Child loggers inherit all configuration from their parent but include
   * extra context that will be added to all log messages. This is useful for
   * adding request-specific context like user IDs, correlation IDs, or transaction IDs.
   *
   * @param extra - Additional context to bind to all log messages from this child logger
   * @returns A new Logger instance with merged context
   *
   * @example
   * ```typescript
   * const requestLogger = logger.child({
   *   requestId: 'req-123',
   *   userId: 'user-456'
   * });
   *
   * requestLogger.info('Processing request'); // Will include requestId and userId
   * ```
   */
  child(extra: Bindings): Logger {
    const c = new Logger({
      level: this.level,
      bindings: { ...this.bindings, ...extra },
      service: this.service,
      env: this.env,
      version: this.version,
      console: {
        enabled: !!this.transports.find((t) => t instanceof ConsoleTransport),
      },
      file: undefined,
      adapters: this.adapters,
      pretty: this.pretty,
      structured: this.structured,
      now: this.now,
      random: this.random,
      traceProvider: this.traceProvider,
      sampling: this.sampling,
      redaction: this.redactor ? { enabled: true } : undefined,
      correlationId: this.correlationId,
    });

    // Directly set transports on child logger instance
    c.transports = this.transports;

    // Share the same redactor instance
    if (this.redactor) {
      c.redactor = this.redactor;
    }

    return c;
  }

  /**
   * Sets the minimum log level for this logger instance.
   *
   * Only messages at or above this level will be processed and output.
   * The log levels in order of severity are: trace < debug < info < warn < error < fatal.
   *
   * @param level - The minimum log level to output
   *
   * @example
   * ```typescript
   * logger.setLevel('warn'); // Only warn, error, and fatal messages will be logged
   * ```
   */
  setLevel(level: LogLevel): void {
    this.level = level;
  }

  /**
   * Determines if a message at the given level should be logged based on the current log level.
   *
   * @param level - The log level to check
   * @returns True if the message should be logged, false otherwise
   */
  private shouldLog(level: LogLevel): boolean {
    return levelOrder[level] >= levelOrder[this.level];
  }

  /**
   * Determines if a message should be logged based on sampling configuration.
   *
   * Sampling allows reducing log volume by only logging a percentage of messages
   * at certain levels, which is useful for high-volume applications.
   *
   * @param level - The log level to check against sampling rules
   * @returns True if the message passes sampling, false otherwise
   */
  private passSampling(level: LogLevel): boolean {
    const r = this.sampling?.rates?.[level] ?? this.sampling?.defaultRate;
    if (r == null) return true;
    if (r >= 1) return true;
    if (r <= 0) return false;
    return this.random() < r;
  }

  /**
   * Creates a standardized log record with all required fields.
   *
   * This method handles redaction, correlation IDs, trace information,
   * and error object normalization to create a consistent log record format.
   *
   * @param level - The log level for this record
   * @param message - The log message (already redacted)
   * @param context - Additional context data (already redacted)
   * @param error - Optional error object to include
   * @returns A complete LogRecord ready for formatting and output
   */
  private baseRecord(
    level: LogLevel,
    message: string,
    context?: Bindings,
    error?: unknown,
  ): LogRecord {
    // Apply redaction to context if enabled
    const redactedContext =
      this.redactor && context
        ? (this.redactor.redact(context) as Bindings)
        : context;

    const rec: LogRecord = {
      time: this.now(),
      level,
      msg: this.redactor ? (this.redactor.redact(message) as string) : message,
      service: this.service,
      env: this.env,
      version: this.version,
    };

    // Add correlation ID if available
    const correlationId =
      typeof this.correlationId === "function"
        ? this.correlationId()
        : this.correlationId;
    if (correlationId) {
      rec.traceId = correlationId;
    }

    // Add redacted context if present
    if (redactedContext && Object.keys(redactedContext).length) {
      rec.context = { ...this.bindings, ...redactedContext };
    }
    // Add bindings if no context is provided
    else if (Object.keys(this.bindings).length) {
      rec.context = { ...this.bindings };
    }

    // Attach error information if provided
    try {
      const tr = this.traceProvider?.();
      if (tr?.traceId && !rec.traceId) rec.traceId = tr.traceId;
      if (tr?.spanId) rec.spanId = tr.spanId;
    } catch {}

    if (error) {
      let errorObject: Record<string, unknown> = {};

      if (error instanceof Error) {
        errorObject = {
          name: error.name,
          message: error.message,
          stack: error.stack,
        };
      } else if (typeof error === "object" && error !== null) {
        const e = error as Record<string, unknown>;
        errorObject = {
          name: e.name as string | undefined,
          message: e.message as string | undefined,
          stack: e.stack as string | undefined,
          ...e,
        };
      } else {
        errorObject = { message: String(error) };
      }

      // Apply redaction to error object
      rec.err = this.redactor
        ? (this.redactor.redact(errorObject) as typeof rec.err)
        : errorObject;
    }

    return rec;
  }

  /**
   * Formats a log record into the appropriate output string.
   *
   * The format depends on configuration:
   * - Pretty format for development (colored, human-readable)
   * - Structured formats for production (JSON, ECS, Datadog, Splunk)
   *
   * @param rec - The log record to format
   * @returns The formatted log line as a string
   */
  private format(rec: LogRecord): string {
    // Pretty format
    if (this.pretty.enabled) {
      return this.pretty.formatter
        ? this.pretty.formatter(rec)
        : prettyLine(rec, this.pretty.theme);
    }

    // Structured formats
    switch (this.structured.type) {
      case "ecs":
        return this.structured.map
          ? JSON.stringify(this.structured.map(rec))
          : ecsLine(rec);
      case "datadog":
        return this.structured.map
          ? JSON.stringify(this.structured.map(rec))
          : datadogLine(rec);
      case "splunk":
        return this.structured.map
          ? JSON.stringify(this.structured.map(rec))
          : splunkLine(rec);
      default:
        return this.structured.map
          ? JSON.stringify(this.structured.map(rec))
          : jsonLine(rec);
    }
  }

  /**
   * Outputs a log record to all configured transports and adapters.
   *
   * This method handles the actual writing of log data to destinations
   * like console, files, HTTP endpoints, and external providers.
   *
   * @param rec - The log record to output
   */
  private out(rec: LogRecord): void {
    const isError = rec.level === "error" || rec.level === "fatal";
    const line = this.format(rec);

    // Write to transports
    for (const t of this.transports) t.write(rec, line, isError);

    // Send to provider adapters
    for (const a of this.adapters) {
      const ok = !a.level || levelOrder[rec.level] >= levelOrder[a.level];
      if (ok) Promise.resolve(a.handle(rec)).catch(() => {});
    }
  }

  /**
   * Parses and normalizes the arguments passed to log methods.
   *
   * Log methods accept flexible arguments: (message, context?, error?)
   * This method extracts the message, context object, and error from the arguments
   * in any order they were provided.
   *
   * @param message - The primary message (string or convertible to string)
   * @param a1 - First optional argument (context object or Error)
   * @param a2 - Second optional argument (context object or Error)
   * @returns Object containing parsed msg, context, and error
   */
  private parseArgs(
    message: unknown,
    a1?: unknown,
    a2?: unknown,
  ): { msg: string; context?: Bindings; error?: unknown } {
    const msg = typeof message === "string" ? message : String(message);
    let context: Bindings | undefined;
    let error: unknown;

    if (a1 instanceof Error) error = a1;
    else if (typeof a1 === "object" && a1) context = a1 as Bindings;

    if (!error && a2 instanceof Error) error = a2;
    else if (!context && typeof a2 === "object" && a2) context = a2 as Bindings;

    return { msg, context, error };
  }

  /**
   * Logs a trace-level message.
   *
   * Trace is the most verbose log level, typically used for detailed
   * debugging information and step-by-step execution tracing.
   *
   * @param message - The log message
   * @param a1 - Optional context object or Error
   * @param a2 - Optional context object or Error (if a1 was the other type)
   *
   * @example
   * ```typescript
   * logger.trace('Entering function', { function: 'processData', id: 123 });
   * logger.trace('Cache miss', key, new Error('Cache unavailable'));
   * ```
   */
  trace(message: unknown, a1?: unknown, a2?: unknown): void {
    if (!this.shouldLog("trace")) return;
    if (!this.passSampling("trace")) return;

    const { msg, context, error } = this.parseArgs(message, a1, a2);
    this.out(this.baseRecord("trace", msg, context, error));
  }

  /**
   * Logs a debug-level message.
   *
   * Debug messages contain detailed information useful for developers
   * during development and troubleshooting, but are typically too verbose
   * for production environments.
   *
   * @param message - The log message
   * @param a1 - Optional context object or Error
   * @param a2 - Optional context object or Error (if a1 was the other type)
   *
   * @example
   * ```typescript
   * logger.debug('Database query executed', { query: 'SELECT * FROM users', duration: 45 });
   * ```
   */
  debug(message: unknown, a1?: unknown, a2?: unknown): void {
    if (!this.shouldLog("debug")) return;
    if (!this.passSampling("debug")) return;

    const { msg, context, error } = this.parseArgs(message, a1, a2);
    this.out(this.baseRecord("debug", msg, context, error));
  }

  /**
   * Logs an info-level message.
   *
   * Info messages provide general information about application state
   * and important events. This is typically the default log level for
   * production environments.
   *
   * @param message - The log message
   * @param a1 - Optional context object or Error
   * @param a2 - Optional context object or Error (if a1 was the other type)
   *
   * @example
   * ```typescript
   * logger.info('User logged in', { userId: 'user-123', ip: '192.168.1.1' });
   * logger.info('Server started', { port: 3000, env: 'production' });
   * ```
   */
  info(message: unknown, a1?: unknown, a2?: unknown): void {
    if (!this.shouldLog("info")) return;
    if (!this.passSampling("info")) return;

    const { msg, context, error } = this.parseArgs(message, a1, a2);
    this.out(this.baseRecord("info", msg, context, error));
  }

  /**
   * Logs a warning-level message.
   *
   * Warning messages indicate potential problems that don't prevent
   * the application from running but may require attention.
   *
   * @param message - The log message
   * @param a1 - Optional context object or Error
   * @param a2 - Optional context object or Error (if a1 was the other type)
   *
   * @example
   * ```typescript
   * logger.warn('API rate limit approaching', { current: 95, limit: 100 });
   * logger.warn('Deprecated feature used', { feature: 'old_api', version: '1.0' });
   * ```
   */
  warn(message: unknown, a1?: unknown, a2?: unknown): void {
    if (!this.shouldLog("warn")) return;
    if (!this.passSampling("warn")) return;

    const { msg, context, error } = this.parseArgs(message, a1, a2);
    this.out(this.baseRecord("warn", msg, context, error));
  }

  /**
   * Logs an error-level message.
   *
   * Error messages indicate problems that occurred but didn't cause
   * the application to crash. These typically represent exceptions
   * or failures that were handled gracefully.
   *
   * @param message - The log message
   * @param a1 - Optional context object or Error
   * @param a2 - Optional context object or Error (if a1 was the other type)
   *
   * @example
   * ```typescript
   * logger.error('Database connection failed', error);
   * logger.error('Validation failed', { field: 'email', value: 'invalid' });
   * ```
   */
  error(message: unknown, a1?: unknown, a2?: unknown): void {
    if (!this.shouldLog("error")) return;
    if (!this.passSampling("error")) return;

    const { msg, context, error } = this.parseArgs(message, a1, a2);
    this.out(this.baseRecord("error", msg, context, error));
  }

  /**
   * Logs a fatal-level message.
   *
   * Fatal messages indicate critical errors that typically cause
   * the application to terminate or become non-functional.
   * These are the most severe log level.
   *
   * @param message - The log message
   * @param a1 - Optional context object or Error
   * @param a2 - Optional context object or Error (if a1 was the other type)
   *
   * @example
   * ```typescript
   * logger.fatal('Out of memory', error);
   * logger.fatal('Cannot connect to database', new Error('Connection timeout'));
   * ```
   */
  fatal(message: unknown, a1?: unknown, a2?: unknown): void {
    if (!this.shouldLog("fatal")) return;
    if (!this.passSampling("fatal")) return;

    const { msg, context, error } = this.parseArgs(message, a1, a2);
    this.out(this.baseRecord("fatal", msg, context, error));
  }

  /**
   * Flushes all buffered log messages to their destinations.
   *
   * This method ensures that any buffered log data is written out
   * immediately. It's useful to call this before application shutdown
   * or when you need to guarantee log persistence.
   *
   * @returns Promise that resolves when all transports have been flushed
   *
   * @example
   * ```typescript
   * // Graceful shutdown
   * await logger.flush();
   * await logger.close();
   * process.exit(0);
   * ```
   */
  async flush(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.flush?.()));
  }

  /**
   * Closes all transports and releases resources.
   *
   * This method should be called when the logger is no longer needed,
   * typically during application shutdown. It closes file handles,
   * HTTP connections, and other resources used by transports.
   *
   * @returns Promise that resolves when all transports have been closed
   *
   * @example
   * ```typescript
   * process.on('SIGTERM', async () => {
   *   await logger.close();
   *   process.exit(0);
   * });
   * ```
   */
  async close(): Promise<void> {
    await Promise.all(this.transports.map((t) => t.close?.()));
  }
}

/**
 * Creates a new Logger instance with the specified options.
 *
 * This is a convenience function that creates a Logger with default
 * configuration. It's equivalent to `new Logger(opts)`.
 *
 * @param opts - Logger configuration options
 * @returns A new Logger instance
 *
 * @example
 * ```typescript
 * const logger = createLogger({
 *   level: 'info',
 *   service: 'my-api',
 *   pretty: { enabled: true }
 * });
 * ```
 */
export function createLogger(opts: LoggerOptions = {}): Logger {
  return new Logger(opts);
}
