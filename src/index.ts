export {
  datadogLine,
  datadogObject,
  ecsLine,
  ecsObject,
  jsonLine,
  prettyLine,
  splunkLine,
  splunkObject,
} from "./format";

// OpenTelemetry Integration
export {
  configureLoggerWithOtel,
  createOpenTelemetryAdapter,
  createOtelTraceProvider,
  OpenTelemetryAdapter,
  otelExpressMiddleware,
  OtelHelpers,
  type OpenTelemetryOptions,
} from "./integrations/opentelemetry";

export { createLogger, Logger } from "./logger";

// Middleware
export {
  createCorrelationIdGenerator,
  expressMiddleware,
  fastifyPlugin,
  koaMiddleware,
} from "./middleware";

// Redaction
export {
  createRedactor,
  Redactor,
  redactSensitive,
} from "./redaction";

// Runtime Configuration
export {
  createConfigurableLogger,
  getRuntimeConfig,
  initializeRuntimeConfig,
  LogLevelCLI,
  RuntimeConfig,
  type RuntimeConfigOptions,
} from "./runtime-config";
export {
  BufferedTransport,
  createBufferedTransport,
} from "./transports/buffered";

// Transports
export { ConsoleTransport } from "./transports/console";
export { FileTransport } from "./transports/file";
export { createHttpTransport, HttpTransport } from "./transports/http";

// Types
export type {
  AsyncTransport,
  Bindings,
  ConsoleSinkOptions,
  FileRotationPolicy,
  FileSinkOptions,
  LoggerOptions,
  LogLevel,
  LogRecord,
  PrettyOptions,
  ProviderAdapter,
  RedactionOptions,
  RedactionPattern,
  SamplingOptions,
  StructuredOptions,
  Theme,
  Transport,
  TransportOptions,
} from "./types";
