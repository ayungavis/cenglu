import type { LoggerPlugin, LogLevel, LogRecord } from "../types";

export type SamplingPluginOptions = {
  /**
   * Per-level sampling rates (0-1)
   * 1 = log all, 0 = log none, 0.5 = log 50%
   */
  rates?: Partial<Record<LogLevel, number>>;
  defaultRate?: number;
  alwaysLogErrors?: boolean;
  alwaysLogFatal?: boolean;
  random?: () => number;
  onDrop?: (record: LogRecord) => void;
  shouldSample?: (record: LogRecord) => boolean;
};

/**
 * Plugin that samples logs based on configured rates
 *
 * This is useful for high-volume logging where you want to reduce
 * the amount of logs while still maintaining visibility.
 *
 * @example
 * // Sample 10% of debug logs, 100% of errors
 * const logger = createLogger({
 *   plugins: [
 *     samplingPlugin({
 *       rates: {
 *         trace: 0,      // Drop all trace logs
 *         debug: 0.1,    // Keep 10% of debug logs
 *         info: 0.5,     // Keep 50% of info logs
 *         warn: 1.0,     // Keep all warnings
 *       },
 *       alwaysLogErrors: true, // Always keep errors
 *     }),
 *   ],
 * });
 *
 * @example
 * // Custom sampling based on content
 * const logger = createLogger({
 *   plugins: [
 *     samplingPlugin({
 *       shouldSample: (record) => {
 *         // Always sample logs with specific context
 *         if (record.context?.important) return true;
 *         // Sample 10% of everything else
 *         return Math.random() < 0.1;
 *       },
 *     }),
 *   ],
 * });
 */
export function samplingPlugin(options: SamplingPluginOptions = {}): LoggerPlugin {
  const {
    rates = {},
    defaultRate = 1.0,
    alwaysLogErrors = true,
    alwaysLogFatal = true,
    random = Math.random,
    onDrop,
    shouldSample,
  } = options;

  // Pre-compute which levels should always be logged
  const alwaysLog = new Set<LogLevel>();
  if (alwaysLogErrors) {
    alwaysLog.add("error");
  }
  if (alwaysLogFatal) {
    alwaysLog.add("fatal");
  }

  // Stats for debugging
  let _totalRecords = 0;
  let _droppedRecords = 0;

  return {
    name: "sampling",
    order: 5, // Run very early to avoid unnecessary processing

    onRecord(record: LogRecord): LogRecord | null {
      _totalRecords += 1;

      // Always log certain levels
      if (alwaysLog.has(record.level)) {
        return record;
      }

      // Use custom sampling function if provided
      if (shouldSample) {
        if (shouldSample(record)) {
          return record;
        }
        _droppedRecords += 1;
        onDrop?.(record);
        return null;
      }

      // Get rate for this level
      const rate = rates[record.level] ?? defaultRate;

      // Fast paths
      if (rate >= 1) {
        return record;
      }
      if (rate <= 0) {
        _droppedRecords += 1;
        onDrop?.(record);
        return null;
      }

      // Sample
      if (random() < rate) {
        return record;
      }

      _droppedRecords += 1;
      onDrop?.(record);
      return null;
    },
  };
}

/**
 * Create a deterministic sampling plugin based on a hash
 *
 * This ensures the same log message is always either sampled or not,
 * which can be useful for consistent behavior.
 *
 * @example
 * const logger = createLogger({
 *   plugins: [
 *     deterministicSamplingPlugin({
 *       rate: 0.1,
 *       hashField: "msg", // Sample based on message content
 *     }),
 *   ],
 * });
 */
export function deterministicSamplingPlugin(options: {
  rate: number;
  hashField?: "msg" | "traceId" | "correlationId";
  alwaysLogErrors?: boolean;
}): LoggerPlugin {
  const { rate, hashField = "msg", alwaysLogErrors = true } = options;

  /**
   * Simple string hash function
   */
  function hashString(str: string): number {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash; // Convert to 32-bit integer
    }
    return Math.abs(hash);
  }

  return {
    name: "deterministic-sampling",
    order: 5,

    onRecord(record: LogRecord): LogRecord | null {
      // Always log errors
      if (alwaysLogErrors && (record.level === "error" || record.level === "fatal")) {
        return record;
      }

      // Get the field to hash
      let value: string;
      switch (hashField) {
        case "traceId":
          value = record.traceId ?? record.msg;
          break;
        case "correlationId":
          value = record.traceId ?? record.msg; // Use traceId as correlationId
          break;
        default:
          value = record.msg;
      }

      // Compute hash and check against rate
      const hash = hashString(value);
      const threshold = Math.floor(rate * 0xff_ff_ff_ff);

      if (hash % 0xff_ff_ff_ff < threshold) {
        return record;
      }

      return null;
    },
  };
}
