/**
 * Logger plugins for extending functionality
 *
 * Plugins provide a way to extend the logger without modifying the core.
 * They can intercept, modify, or drop log records, and react to lifecycle events.
 *
 * @example
 * import { createLogger, samplingPlugin, rateLimitPlugin } from "cenglu";
 *
 * const logger = createLogger({
 *   plugins: [
 *     samplingPlugin({ defaultRate: 0.1 }),
 *     rateLimitPlugin({ maxLogs: 1000, windowMs: 1000 }),
 *   ],
 * });
 */

// biome-ignore lint/performance/noBarrelFile: organized exports
export { type BatchingPluginOptions, batchingPlugin } from "./batching";
export { type EnrichPluginOptions, enrichPlugin } from "./enrich";
export { type FilterPluginOptions, filterPlugin } from "./filter";
export { type MetricsCollector, type MetricsPluginOptions, metricsPlugin } from "./metrics";
export { type RateLimitPluginOptions, rateLimitPlugin } from "./rate-limit";
export { type RedactionPluginOptions, redactionPlugin } from "./redaction";
export { type SamplingPluginOptions, samplingPlugin } from "./sampling";
