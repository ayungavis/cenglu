export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type Bindings = {
  [key: string]: unknown;
};

export type ErrorInfo = {
  name?: string;
  message?: string;
  stack?: string;
  code?: string | number;
  cause?: ErrorInfo;
  [key: string]: unknown;
};

export type LogRecord = {
  time: number;
  level: LogLevel;
  msg: string;
  context?: Bindings;
  err?: ErrorInfo | null;
  service?: string;
  env?: string;
  version?: string;
  traceId?: string;
  spanId?: string;
};

export type TraceContext = {
  traceId?: string;
  spanId?: string;
};

export type Transport = {
  write(record: LogRecord, formatted: string, isError: boolean): void;
  flush?(): Promise<void>;
  close?(): Promise<void>;
};

export type AsyncTransport = {
  write(record: LogRecord, formatted: string, isError: boolean): Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
  onError?: (error: Error, record: LogRecord) => void;
};

export type LoggerPlugin = {
  readonly name: string;
  readonly order?: number;
  onInit?(logger: unknown): void;
  onRecord?(record: LogRecord): LogRecord | null;
  onFormat?(record: LogRecord, formatted: string): string;
  onWrite?(record: LogRecord, formatted: string): void;
  onFlush?(): Promise<void> | void;
  onClose?(): Promise<void> | void;
};

export type ProviderAdapter = {
  readonly name: string;
  level?: LogLevel;
  handle(record: LogRecord): void | Promise<void>;
};

export type ConsoleOptions = {
  enabled?: boolean;
  stream?: NodeJS.WritableStream;
  errorStream?: NodeJS.WritableStream;
};

export type FileRotationPolicy = {
  intervalDays?: number;
  maxBytes?: number;
  maxFiles?: number;
  compress?: "gzip" | false;
  retentionDays?: number;
};

export type FileOptions = {
  enabled?: boolean;
  dir?: string;
  filename?: (info: { date: Date; level: LogLevel; sequence: number }) => string;
  separateErrors?: boolean;
  rotation?: FileRotationPolicy;
};

export type Theme = {
  dim: (s: string) => string;
  gray: (s: string) => string;
  red: (s: string) => string;
  yellow: (s: string) => string;
  green: (s: string) => string;
  cyan: (s: string) => string;
  magenta: (s: string) => string;
  bold: (s: string) => string;
};

export type PrettyOptions = {
  enabled?: boolean;
  theme?: Partial<Theme>;
  formatter?: (record: LogRecord) => string;
};

export type StructuredFormat = {
  type?: "json" | "ecs" | "datadog" | "splunk";
  transform?: (record: LogRecord) => unknown;
};

export type SamplingOptions = {
  rates?: Partial<Record<LogLevel, number>>;
  defaultRate?: number;
};

export type RedactionPattern = {
  pattern: RegExp;
  replacement?: string;
  name?: string;
};

export type RedactionOptions = {
  enabled?: boolean;
  patterns?: RedactionPattern[];
  paths?: string[];
  useDefaults?: boolean;
  customRedactor?: (value: unknown, key?: string) => unknown;
};

export type LoggerOptions = {
  level?: LogLevel;
  service?: string;
  env?: string;
  version?: string;
  bindings?: Bindings;
  console?: ConsoleOptions;
  file?: FileOptions;
  pretty?: PrettyOptions;
  structured?: StructuredFormat;
  adapters?: ProviderAdapter[];
  transports?: Transport[];
  plugins?: LoggerPlugin[];
  sampling?: SamplingOptions;
  redaction?: RedactionOptions;
  correlationId?: string | (() => string | undefined);
  traceProvider?: () => TraceContext | undefined;
  useAsyncContext?: boolean;
  now?: () => number;
  random?: () => number;
};

export type TreeOptions = {
  maxDepth?: number;
  maxArrayLength?: number;
  maxStringLength?: number;
};

export type FormatterType = "json" | "pretty" | "ecs" | "datadog" | "splunk" | "logfmt";

export type LoggerState = {
  readonly level: LogLevel;
  readonly service?: string;
  readonly env?: string;
  readonly version?: string;
  readonly bindings: Readonly<Bindings>;
};

export type LoggerConfig = {
  readonly pretty: Readonly<{
    enabled: boolean;
    theme: Partial<Theme>;
    formatter?: (record: LogRecord) => string;
  }>;
  readonly structured: Readonly<{
    type: "json" | "ecs" | "datadog" | "splunk" | "logfmt";
    transform?: (record: LogRecord) => unknown;
  }>;
  readonly sampling?: Readonly<SamplingOptions>;
  readonly correlationId?: string | (() => string | undefined);
  readonly traceProvider?: () => TraceContext | undefined;
  readonly now: () => number;
  readonly random: () => number;
  readonly useAsyncContext: boolean;
};

export type TimerResult = {
  (): void;
  end(): void;
  elapsed(): number;
  endWithContext(context: Bindings): void;
};
