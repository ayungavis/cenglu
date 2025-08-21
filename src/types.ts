export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";
export interface Bindings {
  [k: string]: unknown;
}
export interface LogRecord {
  time: number;
  level: LogLevel;
  msg: string;
  context?: Bindings;
  err?: {
    name?: string;
    message?: string;
    stack?: string;
    [k: string]: unknown;
  } | null;
  service?: string;
  env?: string;
  version?: string;
  traceId?: string;
  spanId?: string;
}
export interface Transport {
  write(rec: LogRecord, formatted: string, isError: boolean): void;
  flush?(): Promise<void>;
  close?(): Promise<void>;
}

export interface AsyncTransport {
  write(rec: LogRecord, formatted: string, isError: boolean): Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
  onError?: (error: Error, record: LogRecord) => void;
}

export interface TransportOptions {
  errorHandler?: (error: Error, record: LogRecord) => void;
  retryAttempts?: number;
  retryDelay?: number;
  timeout?: number;
  bufferSize?: number;
  flushInterval?: number;
}
export interface ProviderAdapter {
  name: string;
  level?: LogLevel;
  handle(rec: LogRecord): void | Promise<void>;
}
export interface FileRotationPolicy {
  intervalDays?: number;
  maxBytes?: number;
  maxFilesPerPeriod?: number;
  gzip?: boolean;
  compress?: "gzip" | "lz4" | false;
  compressedTtlDays?: number;
}
export interface FileSinkOptions {
  enabled?: boolean;
  dir?: string;
  filename?: (i: {
    date: Date;
    level: LogLevel;
    periodIndex: number;
    sequence: number;
  }) => string;
  separateError?: boolean;
  rotation?: FileRotationPolicy;
}
export interface ConsoleSinkOptions {
  enabled?: boolean;
}
export interface Theme {
  dim: (s: string) => string;
  gray: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  cyan: (s: string) => string;
  magenta: (s: string) => string;
  bold: (s: string) => string;
  reset: (s: string) => string;
}
export interface PrettyOptions {
  enabled?: boolean;
  theme?: Partial<Theme>;
  formatter?: (rec: LogRecord) => string;
}
export interface StructuredOptions {
  type?: "json" | "ecs" | "datadog" | "splunk";
  map?: (rec: LogRecord) => unknown;
}
export interface SamplingOptions {
  rates?: Partial<Record<LogLevel, number>>;
  defaultRate?: number;
}
export interface RedactionPattern {
  pattern: RegExp;
  replacement?: string;
  name?: string;
}

export interface RedactionOptions {
  enabled?: boolean;
  patterns?: RedactionPattern[];
  customRedactor?: (value: unknown, key?: string) => unknown;
  defaultPatterns?: boolean; // Use built-in patterns for common sensitive data
  paths?: string[]; // Specific paths to always redact (e.g., "password", "*.token")
}

export interface LoggerOptions {
  level?: LogLevel;
  service?: string;
  env?: string;
  version?: string;
  bindings?: Bindings;
  console?: ConsoleSinkOptions;
  file?: FileSinkOptions;
  pretty?: PrettyOptions;
  structured?: StructuredOptions;
  adapters?: ProviderAdapter[];
  sampling?: SamplingOptions;
  redaction?: RedactionOptions;
  correlationId?: string | (() => string);
  now?: () => number;
  random?: () => number;
  traceProvider?: () => { traceId?: string; spanId?: string } | undefined;
}
