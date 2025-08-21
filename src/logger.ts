import {
  datadogLine,
  ecsLine,
  jsonLine,
  prettyLine,
  splunkLine,
} from "./format";
import { Redactor } from "./redaction";
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
      (process.env.NODE_ENV === "production" ? "info" : "debug");
    this.bindings = { ...(opts.bindings || {}) };
    this.service = opts.service ?? process.env.SERVICE_NAME;
    this.env = opts.env ?? process.env.NODE_ENV;
    this.version = opts.version ?? process.env.SERVICE_VERSION;
    this.now = opts.now || (() => Date.now());
    this.random = opts.random || Math.random;
    this.traceProvider = opts.traceProvider;

    if (opts.console?.enabled ?? true)
      this.transports.push(new ConsoleTransport());
    const fileEnabled = opts.file?.enabled || process.env.LOG_TO_FILE === "1";
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
        dir: process.env.LOG_DIR || opts.file?.dir,
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

    // Initialize redactor if redaction is enabled
    if (opts.redaction?.enabled !== false) {
      this.redactor = new Redactor(opts.redaction || {});
    }

    // Set correlation ID
    this.correlationId = opts.correlationId;
  }

  child(extra: Bindings) {
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
  setLevel(level: LogLevel) {
    this.level = level;
  }
  private shouldLog(level: LogLevel) {
    return levelOrder[level] >= levelOrder[this.level];
  }
  private passSampling(level: LogLevel) {
    const r = this.sampling?.rates?.[level] ?? this.sampling?.defaultRate;
    if (r == null) return true;
    if (r >= 1) return true;
    if (r <= 0) return false;
    return this.random() < r;
  }

  private baseRecord(
    level: LogLevel,
    msg: string,
    ctx?: Bindings,
    err?: unknown,
  ): LogRecord {
    // Apply redaction to context if enabled
    const redactedCtx =
      this.redactor && ctx ? (this.redactor.redact(ctx) as Bindings) : ctx;

    const rec: LogRecord = {
      time: this.now(),
      level,
      msg: this.redactor ? (this.redactor.redact(msg) as string) : msg,
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

    if (redactedCtx && Object.keys(redactedCtx).length)
      rec.context = { ...this.bindings, ...redactedCtx };
    else if (Object.keys(this.bindings).length)
      rec.context = { ...this.bindings };

    try {
      const tr = this.traceProvider?.();
      if (tr?.traceId && !rec.traceId) rec.traceId = tr.traceId;
      if (tr?.spanId) rec.spanId = tr.spanId;
    } catch {}

    if (err) {
      let errorObj: Record<string, unknown> = {};

      if (err instanceof Error) {
        errorObj = { name: err.name, message: err.message, stack: err.stack };
      } else if (typeof err === "object" && err !== null) {
        const e = err as Record<string, unknown>;
        errorObj = {
          name: e.name as string | undefined,
          message: e.message as string | undefined,
          stack: e.stack as string | undefined,
          ...e,
        };
      } else {
        errorObj = { message: String(err) };
      }

      // Apply redaction to error object
      rec.err = this.redactor
        ? (this.redactor.redact(errorObj) as typeof rec.err)
        : errorObj;
    }
    return rec;
  }

  private format(rec: LogRecord): string {
    if (this.pretty.enabled)
      return this.pretty.formatter
        ? this.pretty.formatter(rec)
        : prettyLine(rec, this.pretty.theme);
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

  private out(rec: LogRecord) {
    const isErr = rec.level === "error" || rec.level === "fatal";
    const line = this.format(rec);
    for (const t of this.transports) t.write(rec, line, isErr);
    for (const a of this.adapters) {
      const ok = !a.level || levelOrder[rec.level] >= levelOrder[a.level];
      if (ok) Promise.resolve(a.handle(rec)).catch(() => {});
    }
  }
  private parseArgs(msg: unknown, a1?: unknown, a2?: unknown) {
    const m = typeof msg === "string" ? msg : String(msg);
    let ctx: Bindings | undefined;
    let e: unknown;
    if (a1 instanceof Error) e = a1;
    else if (typeof a1 === "object" && a1) ctx = a1 as Bindings;
    if (!e && a2 instanceof Error) e = a2;
    else if (!ctx && typeof a2 === "object" && a2) ctx = a2 as Bindings;
    return { m, ctx, e };
  }

  trace(m: unknown, a1?: unknown, a2?: unknown) {
    if (!this.shouldLog("trace")) return;
    if (!this.passSampling("trace")) return;
    const { m: msg, ctx, e } = this.parseArgs(m, a1, a2);
    this.out(this.baseRecord("trace", msg, ctx, e));
  }
  debug(m: unknown, a1?: unknown, a2?: unknown) {
    if (!this.shouldLog("debug")) return;
    if (!this.passSampling("debug")) return;
    const { m: msg, ctx, e } = this.parseArgs(m, a1, a2);
    this.out(this.baseRecord("debug", msg, ctx, e));
  }
  info(m: unknown, a1?: unknown, a2?: unknown) {
    if (!this.shouldLog("info")) return;
    if (!this.passSampling("info")) return;
    const { m: msg, ctx, e } = this.parseArgs(m, a1, a2);
    this.out(this.baseRecord("info", msg, ctx, e));
  }
  warn(m: unknown, a1?: unknown, a2?: unknown) {
    if (!this.shouldLog("warn")) return;
    if (!this.passSampling("warn")) return;
    const { m: msg, ctx, e } = this.parseArgs(m, a1, a2);
    this.out(this.baseRecord("warn", msg, ctx, e));
  }
  error(m: unknown, a1?: unknown, a2?: unknown) {
    if (!this.shouldLog("error")) return;
    const { m: msg, ctx, e } = this.parseArgs(m, a1, a2);
    this.out(this.baseRecord("error", msg, ctx, e));
  }
  fatal(m: unknown, a1?: unknown, a2?: unknown) {
    if (!this.shouldLog("fatal")) return;
    const { m: msg, ctx, e } = this.parseArgs(m, a1, a2);
    this.out(this.baseRecord("fatal", msg, ctx, e));
  }

  async flush() {
    await Promise.all(this.transports.map((t) => t.flush?.()));
  }
  async close() {
    await Promise.all(this.transports.map((t) => t.close?.()));
  }
}
export function createLogger(opts: LoggerOptions = {}) {
  return new Logger(opts);
}
