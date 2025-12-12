import { LEVEL_VALUES, LEVELS } from "./constants";
import { LoggerContext } from "./context";
import { formatDatadog } from "./format/datadog";
import { formatEcs } from "./format/ecs";
import { formatJson } from "./format/json";
import { formatLogfmt } from "./format/logfmt";
import { formatPretty } from "./format/pretty";
import { formatSplunk } from "./format/splunk";
import { Redactor } from "./redaction";
import { ConsoleTransport } from "./transports/console";
import { FileTransport } from "./transports/file";
import type {
  Bindings,
  ErrorInfo,
  LoggerConfig,
  LoggerOptions,
  LoggerPlugin,
  LoggerState,
  LogLevel,
  LogRecord,
  ProviderAdapter,
  TimerResult,
  Transport,
} from "./types";
import {
  extractError,
  getDefaultLevel,
  hasKeys,
  isError,
  isPlainObject,
  isValidLevel,
} from "./utils";

/**
 * A logger with pre-bound context
 *
 * Created via logger.with({ ... }) for fluent context binding
 *
 * @example
 * const bound = logger.with({ requestId: "abc-123" });
 * bound.info("Processing request"); // Includes requestId in context
 */
export class BoundLogger {
  constructor(
    // biome-ignore lint/style/noParameterProperties: preferred for brevity
    private readonly logger: Logger,
    // biome-ignore lint/style/noParameterProperties: preferred for brevity
    private readonly boundContext: Bindings
  ) {}

  /**
   * Merge bound context with additional context
   */
  private mergeContext(extra?: Bindings): Bindings {
    if (!(extra && hasKeys(extra))) {
      return this.boundContext;
    }
    return { ...this.boundContext, ...extra };
  }

  trace(msg: string, context?: Bindings): void {
    this.logger.trace(msg, this.mergeContext(context));
  }

  debug(msg: string, context?: Bindings): void {
    this.logger.debug(msg, this.mergeContext(context));
  }

  info(msg: string, context?: Bindings): void {
    this.logger.info(msg, this.mergeContext(context));
  }

  warn(msg: string, context?: Bindings): void {
    this.logger.warn(msg, this.mergeContext(context));
  }

  error(msg: string, errorOrContext?: Error | Bindings, context?: Bindings): void {
    if (isError(errorOrContext)) {
      this.logger.error(msg, errorOrContext, this.mergeContext(context));
    } else {
      this.logger.error(msg, this.mergeContext(errorOrContext as Bindings));
    }
  }

  fatal(msg: string, errorOrContext?: Error | Bindings, context?: Bindings): void {
    if (isError(errorOrContext)) {
      this.logger.fatal(msg, errorOrContext, this.mergeContext(context));
    } else {
      this.logger.fatal(msg, this.mergeContext(errorOrContext as Bindings));
    }
  }

  with(additionalContext: Bindings): BoundLogger {
    return new BoundLogger(this.logger, {
      ...this.boundContext,
      ...additionalContext,
    });
  }

  child(bindings: Bindings): Logger {
    return this.logger.child({ ...this.boundContext, ...bindings });
  }
}

/**
 * High-performance, feature-rich logger
 *
 * @example
 * // Basic usage
 * const logger = new Logger({ service: "my-app" });
 * logger.info("Hello, world!");
 *
 * // With context
 * logger.info("User logged in", { userId: 123 });
 *
 * // With error
 * logger.error("Failed to process", new Error("Something went wrong"));
 *
 * // Child logger
 * const child = logger.child({ requestId: "abc" });
 * child.info("Processing"); // Includes requestId
 *
 * // Fluent API
 * logger.with({ userId: 123 }).info("User action");
 *
 * // Timer
 * const done = logger.time("database-query");
 * await db.query();
 * done(); // Logs duration
 */
export class Logger {
  private state: LoggerState;
  // biome-ignore lint/style/useReadonlyClassProperties: preferred for brevity
  private config: LoggerConfig;
  // biome-ignore lint/style/useReadonlyClassProperties: preferred for brevity
  private transports: Transport[];
  // biome-ignore lint/style/useReadonlyClassProperties: preferred for brevity
  private adapters: readonly ProviderAdapter[];
  // biome-ignore lint/style/useReadonlyClassProperties: preferred for brevity
  private plugins: readonly LoggerPlugin[];
  // biome-ignore lint/style/useReadonlyClassProperties: preferred for brevity
  private redactor: Redactor | null;
  private closed = false;
  // biome-ignore lint/style/useReadonlyClassProperties: preferred for brevity
  private isChild: boolean;

  constructor(options: LoggerOptions = {}) {
    this.isChild = false;

    // Initialize immutable state
    this.state = Object.freeze({
      level: options.level ?? getDefaultLevel(),
      service: options.service ?? process.env.SERVICE_NAME,
      env: options.env ?? process.env.NODE_ENV,
      version: options.version ?? process.env.SERVICE_VERSION,
      bindings: Object.freeze({ ...options.bindings }),
    });

    // Initialize immutable configuration
    this.config = Object.freeze({
      pretty: Object.freeze({
        enabled: this.detectPrettyMode(options.pretty?.enabled),
        theme: options.pretty?.theme ?? {},
        formatter: options.pretty?.formatter,
      }),
      structured: Object.freeze({
        type: options.structured?.type ?? "json",
        transform: options.structured?.transform,
      }),
      sampling: options.sampling ? Object.freeze({ ...options.sampling }) : undefined,
      correlationId: options.correlationId,
      traceProvider: options.traceProvider,
      now: options.now ?? Date.now,
      random: options.random ?? Math.random,
      useAsyncContext: options.useAsyncContext ?? true,
    });

    // Initialize transports
    this.transports = this.createTransports(options);

    // Initialize adapters
    this.adapters = Object.freeze([...(options.adapters ?? [])]);

    // Initialize plugins (sorted by order)
    this.plugins = this.initializePlugins(options.plugins ?? []);

    // Initialize redactor
    this.redactor = this.createRedactor(options.redaction);

    // Call plugin onInit hooks
    for (const plugin of this.plugins) {
      this.safePluginCall(plugin, "onInit", () => {
        plugin.onInit?.(this);
      });
    }
  }

  private static createChild(parent: Logger, bindings: Bindings): Logger {
    const child = Object.create(Logger.prototype) as Logger;

    // Child inherits parent config but gets new bindings
    child.state = Object.freeze({
      ...parent.state,
      bindings: Object.freeze({ ...parent.state.bindings, ...bindings }),
    });

    // Share immutable config and resources
    child.config = parent.config;
    child.transports = parent.transports; // Share transports
    child.adapters = parent.adapters;
    child.plugins = parent.plugins;
    child.redactor = parent.redactor;
    child.closed = false;
    (child as unknown as { isChild: boolean }).isChild = true;

    return child;
  }

  private detectPrettyMode(explicit?: boolean): boolean {
    if (explicit !== undefined) {
      return explicit;
    }

    try {
      // Enable pretty mode if stdout is a TTY and not in production
      return Boolean(process.stdout?.isTTY) && process.env.NODE_ENV !== "production";
    } catch {
      return false;
    }
  }

  private createTransports(options: LoggerOptions): Transport[] {
    const transports: Transport[] = [];

    // If a test transport was registered globally (by createTestLogger),
    // include it only when the caller did NOT explicitly pass transports.
    // This avoids interfering with code that supplies its own transports.
    // biome-ignore lint/suspicious/noExplicitAny: testing utility
    const testTransport = (globalThis as any).__CENG_LU_TEST_TRANSPORT__ as Transport | undefined;
    if (testTransport && options.transports === undefined) {
      transports.push(testTransport);
    }

    // Console transport (enabled by default)
    if (options.console?.enabled ?? true) {
      transports.push(new ConsoleTransport(options.console));
    }

    // File transport (disabled by default)
    if (this.shouldEnableFileTransport(options)) {
      transports.push(new FileTransport(this.buildFileOptions(options), this.config.now));
    }

    // Add any custom transports
    if (options.transports) {
      transports.push(...options.transports);
    }

    return transports;
  }

  private shouldEnableFileTransport(options: LoggerOptions): boolean {
    return Boolean(options.file?.enabled || process.env.LOG_TO_FILE === "1");
  }

  private buildFileOptions(options: LoggerOptions) {
    const file = options.file ?? {};
    const rotation = file.rotation ?? {};

    return {
      enabled: true,
      dir: process.env.LOG_DIR || file.dir || "./logs",
      separateErrors: file.separateErrors ?? true,
      filename: file.filename,
      rotation: {
        intervalDays: this.parseEnvNumber("LOG_ROTATE_DAYS", rotation.intervalDays) ?? 1,
        maxBytes: this.parseEnvNumber("LOG_MAX_BYTES", rotation.maxBytes) ?? 10 * 1024 * 1024,
        maxFiles: this.parseEnvNumber("LOG_MAX_FILES", rotation.maxFiles) ?? 10,
        compress: this.parseCompress(rotation.compress),
        retentionDays: this.parseEnvNumber("LOG_RETENTION_DAYS", rotation.retentionDays),
      },
    };
  }

  private parseEnvNumber(key: string, fallback?: number): number | undefined {
    const value = process.env[key];
    if (value === undefined) {
      return fallback;
    }
    const parsed = Number(value);
    return Number.isFinite(parsed) ? parsed : fallback;
  }

  private parseCompress(value?: "gzip" | false): "gzip" | false {
    const env = process.env.LOG_COMPRESS;
    if (env === "gzip") {
      return "gzip";
    }
    if (env === "false" || env === "0") {
      return false;
    }
    return value ?? false;
  }

  private createRedactor(options?: LoggerOptions["redaction"]): Redactor | null {
    if (options?.enabled === false) {
      return null;
    }
    return new Redactor(options ?? {});
  }

  private initializePlugins(plugins: LoggerPlugin[]): readonly LoggerPlugin[] {
    const sorted = [...plugins].sort((a, b) => (a.order ?? 100) - (b.order ?? 100));
    return Object.freeze(sorted);
  }

  /**
   * Create a child logger with additional bindings
   *
   * Child loggers share transports and configuration with the parent,
   * but have their own bindings that are merged with the parent's.
   *
   * @param bindings - Additional bindings for the child logger
   * @returns A new child logger
   *
   * @example
   * const requestLogger = logger.child({ requestId: "abc-123" });
   * requestLogger.info("Processing request"); // Includes requestId
   */
  child(bindings: Bindings): Logger {
    return Logger.createChild(this, bindings);
  }

  /**
   * Create a bound logger with context
   *
   * Unlike child(), this doesn't create a full logger instance.
   * It's more lightweight for temporary context binding.
   *
   * @param context - Context to bind
   * @returns A BoundLogger instance
   *
   * @example
   * logger.with({ userId: 123 }).info("User action");
   */
  with(context: Bindings): BoundLogger {
    return new BoundLogger(this, context);
  }

  /**
   * Set the minimum log level
   *
   * @param level - The new minimum level
   * @throws TypeError if level is invalid
   *
   * @example
   * logger.setLevel("debug");
   */
  setLevel(level: LogLevel): void {
    if (!isValidLevel(level)) {
      throw new TypeError(
        `Invalid log level: ${String(level)}. Valid levels: ${LEVELS.join(", ")}`
      );
    }
    this.state = Object.freeze({ ...this.state, level });
  }

  getLevel(): LogLevel {
    return this.state.level;
  }

  /**
   * Check if a level is enabled
   *
   * @param level - The level to check
   * @returns true if the level would be logged
   *
   * @example
   * if (logger.isLevelEnabled("debug")) {
   *   // Compute expensive debug data
   * }
   */
  isLevelEnabled(level: LogLevel): boolean {
    return this.shouldLog(level);
  }

  /**
   * Log at trace level
   *
   * @param msg - The message to log
   * @param arg1 - Optional context object or error
   * @param arg2 - Optional error (if arg1 is context) or context (if arg1 is error)
   */
  trace(msg: unknown, arg1?: unknown, arg2?: unknown): void {
    this.log("trace", msg, arg1, arg2);
  }

  /**
   * Log at debug level
   */
  debug(msg: unknown, arg1?: unknown, arg2?: unknown): void {
    this.log("debug", msg, arg1, arg2);
  }

  /**
   * Log at info level
   */
  info(msg: unknown, arg1?: unknown, arg2?: unknown): void {
    this.log("info", msg, arg1, arg2);
  }

  /**
   * Log at warn level
   */
  warn(msg: unknown, arg1?: unknown, arg2?: unknown): void {
    this.log("warn", msg, arg1, arg2);
  }

  /**
   * Log at error level
   */
  error(msg: unknown, arg1?: unknown, arg2?: unknown): void {
    this.log("error", msg, arg1, arg2);
  }

  /**
   * Log at fatal level
   */
  fatal(msg: unknown, arg1?: unknown, arg2?: unknown): void {
    this.log("fatal", msg, arg1, arg2);
  }

  /**
   * Log at a specific level (dynamic)
   *
   * @param level - The level to log at
   * @param msg - The message to log
   * @param context - Optional context
   */
  logAt(level: LogLevel, msg: string, context?: Bindings): void {
    this.log(level, msg, context);
  }

  /**
   * Create a timer for measuring operation duration
   *
   * @param label - Label for the timer
   * @param context - Optional context to include
   * @returns A function to end the timer
   *
   * @example
   * const done = logger.time("database-query");
   * await db.query();
   * done(); // Logs: "database-query completed" { durationMs: 42 }
   *
   * // Or with additional context:
   * done.endWithContext({ rowCount: 100 });
   */
  time(label: string, context?: Bindings): TimerResult {
    const start = this.config.now();

    const end = () => {
      const durationMs = this.config.now() - start;
      this.info(`${label} completed`, { ...context, durationMs });
    };

    const elapsed = () => this.config.now() - start;

    const endWithContext = (extraContext: Bindings) => {
      const durationMs = this.config.now() - start;
      this.info(`${label} completed`, { ...context, ...extraContext, durationMs });
    };

    // Create the result object with both callable and methods
    const result = end as TimerResult;
    result.end = end;
    result.elapsed = elapsed;
    result.endWithContext = endWithContext;

    return result;
  }

  /**
   * Conditional logging - only evaluates the function if trace level is enabled
   *
   * Useful for expensive-to-compute log data
   *
   * @example
   * logger.ifTrace(() => [
   *   "Detailed state",
   *   { state: computeExpensiveState() }
   * ]);
   */
  ifTrace(fn: () => [string, Bindings?]): void {
    if (this.shouldLog("trace")) {
      const [msg, context] = fn();
      this.trace(msg, context);
    }
  }

  /**
   * Conditional logging at debug level
   */
  ifDebug(fn: () => [string, Bindings?]): void {
    if (this.shouldLog("debug")) {
      const [msg, context] = fn();
      this.debug(msg, context);
    }
  }

  /**
   * Conditional logging at info level
   */
  ifInfo(fn: () => [string, Bindings?]): void {
    if (this.shouldLog("info")) {
      const [msg, context] = fn();
      this.info(msg, context);
    }
  }

  /**
   * Flush all buffered logs
   *
   * Call this before shutting down to ensure all logs are written.
   */
  async flush(): Promise<void> {
    // Flush plugins first
    const pluginFlushes = this.plugins
      .filter((p) => typeof p.onFlush === "function")
      .map((p) => this.safePluginCallAsync(p, "onFlush", () => Promise.resolve(p.onFlush?.())));

    // Then flush transports
    const transportFlushes = this.transports
      .filter((t) => typeof t.flush === "function")
      .map((t) =>
        t.flush?.().catch((err) => {
          this.handleTransportError(err, t);
        })
      );

    await Promise.all([...pluginFlushes, ...transportFlushes]);
  }

  /**
   * Close the logger and release all resources
   *
   * After closing, the logger will not accept new logs.
   * Child loggers should not be closed directly - close the parent instead.
   */
  async close(): Promise<void> {
    if (this.closed) {
      return;
    }

    // Don't close resources if this is a child logger
    if (this.isChild) {
      this.closed = true;
      return;
    }

    this.closed = true;

    // Flush first
    await this.flush();

    // Close plugins
    const pluginCloses = this.plugins
      .filter((p) => typeof p.onClose === "function")
      .map((p) => this.safePluginCallAsync(p, "onClose", () => Promise.resolve(p.onClose?.())));

    // Close transports
    const transportCloses = this.transports
      .filter((t) => typeof t.close === "function")
      .map((t) =>
        t.close?.().catch((err) => {
          this.handleTransportError(err, t);
        })
      );

    await Promise.all([...pluginCloses, ...transportCloses]);
  }

  private shouldLog(level: LogLevel): boolean {
    return LEVEL_VALUES[level] >= LEVEL_VALUES[this.state.level];
  }

  private shouldSample(level: LogLevel): boolean {
    const { sampling } = this.config;
    if (!sampling) {
      return true;
    }

    const rate = sampling.rates?.[level] ?? sampling.defaultRate;
    if (rate === undefined || rate >= 1) {
      return true;
    }
    if (rate <= 0) {
      return false;
    }

    return this.config.random() < rate;
  }

  private log(level: LogLevel, msg: unknown, arg1?: unknown, arg2?: unknown): void {
    // Fast path: check level first
    if (!this.shouldLog(level)) {
      return;
    }

    // Check sampling
    if (!this.shouldSample(level)) {
      return;
    }

    // Don't log if closed
    if (this.closed) {
      return;
    }

    // Parse arguments
    const { msg: message, context, error } = this.parseArgs(msg, arg1, arg2);

    // Build the log record
    let record = this.buildRecord(level, message, context, error);

    // Run through plugins
    for (const plugin of this.plugins) {
      if (plugin.onRecord) {
        const result = this.safePluginCall(plugin, "onRecord", () => plugin.onRecord?.(record));

        if (result === null) {
          // Plugin dropped the record
          return;
        }

        if (result !== undefined) {
          record = result;
        }
      }
    }

    // Emit the record
    this.emit(record);
  }

  private parseArgs(
    msg: unknown,
    arg1?: unknown,
    arg2?: unknown
  ): { msg: string; context?: Bindings; error?: unknown } {
    const parsedMsg = typeof msg === "string" ? msg : String(msg);
    let context: Bindings | undefined;
    let error: unknown;

    const looksLikeError = (v: unknown): boolean =>
      typeof v === "object" &&
      v !== null &&
      (("message" in (v as Record<string, unknown>) &&
        (v as Record<string, unknown>).message !== undefined) ||
        "name" in (v as Record<string, unknown>) ||
        "stack" in (v as Record<string, unknown>) ||
        "code" in (v as Record<string, unknown>));

    if (isError(arg1)) {
      // First arg is an Error instance
      error = arg1;
      if (isPlainObject(arg2)) {
        context = arg2 as Bindings;
      }
    } else if (isPlainObject(arg1)) {
      // Plain object first arg: decide whether it's an error-like object or context
      if (looksLikeError(arg1)) {
        error = arg1;
        // If a second arg is a plain object, treat it as context
        if (isPlainObject(arg2)) {
          context = arg2 as Bindings;
        }
      } else {
        // Treat as context
        context = arg1 as Bindings;
        if (isError(arg2)) {
          error = arg2;
        }
      }
    } else if (arg1 !== undefined) {
      // Non-object, non-error first arg (e.g. primitive): treat it as an error value
      // If arg2 is a plain object, treat it as context; if arg2 is an Error prefer that as the error.
      error = arg1;
      if (isPlainObject(arg2)) {
        context = arg2 as Bindings;
      } else if (isError(arg2)) {
        error = arg2;
      }
    }

    return { msg: parsedMsg, context, error };
  }

  private buildRecord(
    level: LogLevel,
    msg: string,
    context?: Bindings,
    error?: unknown
  ): LogRecord {
    const record: LogRecord = {
      time: this.config.now(),
      level,
      msg: this.redactor ? this.redactor.redactString(msg) : msg,
      service: this.state.service,
      env: this.state.env,
      version: this.state.version,
    };

    // Add correlation ID
    const correlationId = this.getCorrelationId();
    if (correlationId) {
      record.traceId = correlationId;
    }

    // Add trace context from provider
    this.addTraceContext(record);

    // Merge all contexts
    const mergedContext = this.mergeAllContexts(context);
    if (mergedContext) {
      record.context = this.redactor ? this.redactor.redactObject(mergedContext) : mergedContext;
    }

    // Add error
    if (error !== undefined) {
      const errorInfo = extractError(error);
      record.err = this.redactor ? (this.redactor.redactObject(errorInfo) as ErrorInfo) : errorInfo;
    }

    return record;
  }

  private getCorrelationId(): string | undefined {
    // Check explicit correlationId option first
    const { correlationId } = this.config;
    if (correlationId) {
      const id = typeof correlationId === "function" ? correlationId() : correlationId;
      if (id) {
        return id;
      }
    }

    // Check async context
    if (this.config.useAsyncContext) {
      return LoggerContext.getCorrelationId();
    }

    return;
  }

  private addTraceContext(record: LogRecord): void {
    try {
      const trace = this.config.traceProvider?.();
      if (trace?.traceId && !record.traceId) {
        record.traceId = trace.traceId;
      }
      if (trace?.spanId) {
        record.spanId = trace.spanId;
      }
    } catch {
      // Ignore trace provider errors
    }
  }

  private mergeAllContexts(explicitContext?: Bindings): Bindings | undefined {
    const sources: Bindings[] = [];

    // Logger bindings (from child())
    if (hasKeys(this.state.bindings)) {
      sources.push(this.state.bindings as Bindings);
    }

    // Async context bindings
    if (this.config.useAsyncContext) {
      const asyncBindings = LoggerContext.getBindings();
      if (hasKeys(asyncBindings)) {
        sources.push(asyncBindings);
      }
    }

    // Explicit context from log call
    if (explicitContext && hasKeys(explicitContext)) {
      sources.push(explicitContext);
    }

    // Merge all sources
    if (sources.length === 0) {
      return;
    }
    if (sources.length === 1) {
      return { ...sources[0] };
    }

    return Object.assign({}, ...sources);
  }

  private format(record: LogRecord): string {
    let formatted: string;

    if (this.config.pretty.enabled) {
      const { formatter, theme } = this.config.pretty;
      formatted = formatter ? formatter(record) : formatPretty(record, theme);
    } else {
      const { type, transform } = this.config.structured;

      if (transform) {
        formatted = JSON.stringify(transform(record));
      } else {
        switch (type) {
          case "ecs":
            formatted = formatEcs(record);
            break;
          case "datadog":
            formatted = formatDatadog(record);
            break;
          case "splunk":
            formatted = formatSplunk(record);
            break;
          case "logfmt":
            formatted = formatLogfmt(record);
            break;
          default:
            formatted = formatJson(record);
        }
      }
    }

    // Allow plugins to modify formatted output
    for (const plugin of this.plugins) {
      if (plugin.onFormat) {
        const result = this.safePluginCall(plugin, "onFormat", () =>
          plugin.onFormat?.(record, formatted)
        );
        if (result !== undefined) {
          formatted = result;
        }
      }
    }

    return formatted;
  }

  private emit(record: LogRecord): void {
    const isErrorLevel = record.level === "error" || record.level === "fatal";
    const formatted = this.format(record);

    // Write to transports
    for (const transport of this.transports) {
      try {
        transport.write(record, formatted, isErrorLevel);
      } catch (err) {
        this.handleTransportError(err, transport);
      }
    }

    // Notify plugins
    for (const plugin of this.plugins) {
      if (plugin.onWrite) {
        this.safePluginCall(plugin, "onWrite", () => {
          plugin.onWrite?.(record, formatted);
        });
      }
    }

    // Send to adapters
    for (const adapter of this.adapters) {
      if (this.shouldHandleAdapter(adapter, record.level)) {
        this.invokeAdapter(adapter, record);
      }
    }
  }

  private shouldHandleAdapter(adapter: ProviderAdapter, level: LogLevel): boolean {
    return !adapter.level || LEVEL_VALUES[level] >= LEVEL_VALUES[adapter.level];
  }

  private invokeAdapter(adapter: ProviderAdapter, record: LogRecord): void {
    try {
      const result = adapter.handle(record);
      if (result instanceof Promise) {
        result.catch((err) => this.handleAdapterError(err, adapter));
      }
    } catch (err) {
      this.handleAdapterError(err, adapter);
    }
  }

  private handleTransportError(err: unknown, transport: Transport): void {
    const name = transport.constructor.name;
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[cenglu] Transport "${name}" error: ${message}\n`);
  }

  private handleAdapterError(err: unknown, adapter: ProviderAdapter): void {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[cenglu] Adapter "${adapter.name}" error: ${message}\n`);
  }

  private handlePluginError(err: unknown, plugin: LoggerPlugin, hook: string): void {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[cenglu] Plugin "${plugin.name}" ${hook} error: ${message}\n`);
  }

  private safePluginCall<T>(plugin: LoggerPlugin, hook: string, fn: () => T): T | undefined {
    try {
      return fn();
    } catch (err) {
      this.handlePluginError(err, plugin, hook);
      return;
    }
  }

  private async safePluginCallAsync(
    plugin: LoggerPlugin,
    hook: string,
    fn: () => Promise<void>
  ): Promise<void> {
    try {
      await fn();
    } catch (err) {
      this.handlePluginError(err, plugin, hook);
    }
  }
}

/**
 * Create a new logger instance
 *
 * @param options - Logger configuration options
 * @returns A new Logger instance
 *
 * @example
 * const logger = createLogger({
 *   service: "my-app",
 *   level: "info",
 *   pretty: { enabled: true },
 * });
 */
export function createLogger(options: LoggerOptions = {}): Logger {
  return new Logger(options);
}

export default Logger;
