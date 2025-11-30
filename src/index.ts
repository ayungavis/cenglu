/**
 * cenglu - Fast, zero-dependency, secure logger for Node.js
 *
 * @example
 * // Basic usage
 * import { createLogger } from "cenglu";
 *
 * const logger = createLogger({
 *   service: "my-app",
 *   level: "info",
 * });
 *
 * logger.info("Application started", { port: 3000 });
 * logger.error("Failed to connect", new Error("Connection refused"));
 *
 * @example
 * // With child loggers
 * const requestLogger = logger.child({ requestId: "abc-123" });
 * requestLogger.info("Processing request");
 *
 * @example
 * // With plugins
 * import { createLogger, samplingPlugin, rateLimitPlugin } from "cenglu";
 *
 * const logger = createLogger({
 *   plugins: [
 *     samplingPlugin({ defaultRate: 0.1 }),
 *     rateLimitPlugin({ maxLogs: 1000, windowMs: 1000 }),
 *   ],
 * });
 *
 * @packageDocumentation
 */

// Core
// biome-ignore lint/performance/noBarrelFile: organized exports
export {
  DEFAULT_PATTERNS,
  DEFAULT_SENSITIVE_PATHS,
  DEFAULT_THEME,
  LEVEL_COLORS,
  LEVEL_VALUES,
  LEVELS,
  NO_COLOR_THEME,
} from "./constants";
export type {
  CorrelationIdOptions,
  CorrelationIdStrategy,
  LogContext,
  RequestContextOptions,
} from "./context";
export {
  createCorrelationIdGenerator,
  createRequestContext,
  LoggerContext,
  withBindings,
  withContext,
} from "./context";
// Format
export {
  formatDatadog,
  formatEcs,
  formatISOTimestamp,
  formatJson,
  formatLogfmt,
  formatPretty,
  formatSplunk,
  formatTimestamp,
  getFormatter,
  renderTree,
  toDatadogObject,
  toEcsObject,
  toSplunkObject,
} from "./format";
// Default export
export {
  type BoundLogger,
  createLogger,
  Logger,
  Logger as default,
} from "./logger";
// Plugins
export type { BatchingPluginOptions } from "./plugins/batching";
export {
  batchingPlugin,
  httpBatchingPlugin,
} from "./plugins/batching";
export type { EnrichPluginOptions } from "./plugins/enrich";
export {
  enrichPlugin,
  errorFingerprintPlugin,
  requestEnrichPlugin,
} from "./plugins/enrich";
export type { FilterPluginOptions } from "./plugins/filter";
export {
  filterPlugin,
  timeWindowFilterPlugin,
} from "./plugins/filter";
export type {
  MetricsCollector,
  MetricsPluginOptions,
} from "./plugins/metrics";
export {
  createConsoleMetricsCollector,
  createNoOpMetricsCollector,
  metricsPlugin,
} from "./plugins/metrics";
export type { RateLimitPluginOptions } from "./plugins/rate-limit";
export {
  rateLimitPlugin,
  tokenBucketPlugin,
} from "./plugins/rate-limit";
export type { RedactionPluginOptions } from "./plugins/redaction";
export {
  redactionPlugin,
  strictRedactionPlugin,
} from "./plugins/redaction";
export type { SamplingPluginOptions } from "./plugins/sampling";
export {
  deterministicSamplingPlugin,
  samplingPlugin,
} from "./plugins/sampling";
// Redaction
export {
  createGDPRRedactor,
  createHIPAARedactor,
  createMinimalRedactor,
  createPattern,
  createPCIRedactor,
  createRedactor,
  mergeRedactionOptions,
  Redactor,
  redact,
  redactString,
} from "./redaction";
// Transports
export type {
  BufferedConsoleOptions,
  PrettyConsoleOptions,
} from "./transports/console";
export {
  BufferedConsoleTransport,
  ConsoleTransport,
  createBufferedConsoleTransport,
  createConsoleTransport,
  PrettyConsoleTransport,
} from "./transports/console";
export type { RotatingFileOptions } from "./transports/file";
export {
  createFileTransport,
  createRotatingFileTransport,
  FileTransport,
} from "./transports/file";
// Utils and types
export type {
  AsyncTransport,
  Bindings,
  ConsoleOptions,
  ErrorInfo,
  FileOptions,
  FileRotationPolicy,
  LoggerOptions,
  LoggerPlugin,
  LogLevel,
  LogRecord,
  PrettyOptions,
  ProviderAdapter,
  RedactionOptions,
  RedactionPattern,
  SamplingOptions,
  StructuredFormat,
  Theme,
  TimerResult,
  TraceContext,
  Transport,
} from "./types";
export { isValidLevel } from "./utils";
