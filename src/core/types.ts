export type LogLevel = "trace" | "debug" | "info" | "warn" | "error" | "fatal";

export type LogContext = {
  timestamp: Date;
  level: LogLevel;
  message: string;
  metadata?: Record<string, unknown>;
  error?: Error;
  correlationId?: string;
  service?: string;
  environment?: string;
  [key: string]: unknown;
};

export type Transport = {
  name: string;
  log(context: LogContext): void | Promise<void>;
  flush?(): Promise<void>;
  close?(): Promise<void>;
};

export type Formatter = {
  format(context: LogContext): string | object;
};

export type LoggerConfig = {
  level?: LogLevel;
  service?: string;
  environment?: string;
  transports?: Transport[];
  formatter?: Formatter;
  sampling?: SamplingConfig;
  contextDefaults?: Partial<LogContext>;
  errorSerializer?: (error: Error) => Record<string, unknown>;
};

export type SamplingConfig = {
  enabled: boolean;
  rate: number; // 0.0 to 1.0
  rules?: SamplingRule[];
};

export type SamplingRule = {
  rate: number;
  level?: LogLevel;
  match?: (context: LogContext) => boolean;
};

export type FileTransportConfig = {
  filename: string | ((date: Date) => string);
  dir?: string;
  maxSize?: number; // in bytes
  maxFiles?: number;
  maxAge?: number; // in days
  compress?: boolean;
  separateErrors?: boolean;
  errorFilename?: string | ((date: Date) => string);
  rotationInterval?: "daily" | "weekly" | "monthly" | "number"; // in ms
};

// biome-ignore lint/suspicious/noExplicitAny: the config can be different for each integration
export type Integration<T = any> = {
  name: string;
  init(config: T): void;
  transform?(context: LogContext): LogContext | Promise<LogContext>;
  send?(context: LogContext): Promise<void>;
};
