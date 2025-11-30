import type { LoggerPlugin, LogLevel, LogRecord } from "../types";

export type MetricsCollector = {
  increment(name: string, value?: number, tags?: Record<string, string>): void;
  histogram(name: string, value: number, tags?: Record<string, string>): void;
  gauge?(name: string, value: number, tags?: Record<string, string>): void;
  timing?(name: string, value: number, tags?: Record<string, string>): void;
};

export type MetricsPluginOptions = {
  collector: MetricsCollector;
  prefix?: string;
  tags?: Record<string, string>;
  trackLevels?: boolean;
  trackErrorTypes?: boolean;
  flushInterval?: number;
  metricName?: (base: string, record: LogRecord) => string;
};

/**
 * Plugin that collects metrics about logging
 *
 * This plugin tracks:
 * - Total log count per level
 * - Error counts by type
 * - Log rate
 *
 * @example
 * import { createLogger, metricsPlugin } from "cenglu";
 * import StatsD from "hot-shots";
 *
 * const statsd = new StatsD();
 *
 * const logger = createLogger({
 *   plugins: [
 *     metricsPlugin({
 *       collector: {
 *         increment: (name, value, tags) => statsd.increment(name, value, tags),
 *         histogram: (name, value, tags) => statsd.histogram(name, value, tags),
 *       },
 *       prefix: "myapp.logs",
 *       tags: { service: "api" },
 *     }),
 *   ],
 * });
 */
export function metricsPlugin(options: MetricsPluginOptions): LoggerPlugin {
  const {
    collector,
    prefix = "logs",
    tags = {},
    trackLevels = true,
    trackErrorTypes = true,
    flushInterval = 10_000,
    metricName = (base) => `${prefix}.${base}`,
  } = options;

  // Counters for batching
  const counts: Record<LogLevel, number> = {
    trace: 0,
    debug: 0,
    info: 0,
    warn: 0,
    error: 0,
    fatal: 0,
  };

  const errorCounts: Record<string, number> = {};
  let timer: NodeJS.Timeout | null = null;

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: needed for logic
  function flush(): void {
    // Flush level counts
    if (trackLevels) {
      for (const level of Object.keys(counts) as LogLevel[]) {
        if (counts[level] > 0) {
          collector.increment(metricName("count", {} as LogRecord), counts[level], {
            ...tags,
            level,
          });
          counts[level] = 0;
        }
      }
    }

    // Flush error type counts
    if (trackErrorTypes) {
      for (const [errorType, count] of Object.entries(errorCounts)) {
        if (count > 0) {
          collector.increment(metricName("errors", {} as LogRecord), count, {
            ...tags,
            error_type: errorType,
          });
        }
      }
      // Clear error counts
      for (const key of Object.keys(errorCounts)) {
        delete errorCounts[key];
      }
    }
  }

  function startTimer(): void {
    if (timer) {
      return;
    }

    timer = setInterval(flush, flushInterval);
    timer.unref(); // Don't keep process alive
  }

  /**
   * Stop the flush timer
   */
  function stopTimer(): void {
    if (timer) {
      clearInterval(timer);
      timer = null;
    }
  }

  return {
    name: "metrics",
    order: 90, // Run late, after actual logging

    onInit(): void {
      startTimer();
    },

    onWrite(record: LogRecord): void {
      // Increment level counter
      counts[record.level] += 1;

      // Track error types
      if (trackErrorTypes && record.err) {
        const errorType = record.err.name ?? "UnknownError";
        errorCounts[errorType] = (errorCounts[errorType] ?? 0) + 1;
      }

      // Track errors with additional context
      if (record.level === "error" || record.level === "fatal") {
        collector.increment(metricName("errors.total", record), 1, {
          ...tags,
          level: record.level,
          error_type: record.err?.name ?? "unknown",
        });
      }
    },

    onFlush(): void {
      flush();
    },

    onClose(): void {
      stopTimer();
      flush();
    },
  };
}

export function createConsoleMetricsCollector(): MetricsCollector {
  return {
    increment(name: string, value = 1, tags?: Record<string, string>): void {
      const tagStr = tags ? ` ${JSON.stringify(tags)}` : "";
      console.log(`[METRIC] ${name} += ${value}${tagStr}`);
    },

    histogram(name: string, value: number, tags?: Record<string, string>): void {
      const tagStr = tags ? ` ${JSON.stringify(tags)}` : "";
      console.log(`[METRIC] ${name} = ${value}${tagStr}`);
    },

    gauge(name: string, value: number, tags?: Record<string, string>): void {
      const tagStr = tags ? ` ${JSON.stringify(tags)}` : "";
      console.log(`[METRIC] ${name} := ${value}${tagStr}`);
    },

    timing(name: string, value: number, tags?: Record<string, string>): void {
      const tagStr = tags ? ` ${JSON.stringify(tags)}` : "";
      console.log(`[METRIC] ${name} = ${value}ms${tagStr}`);
    },
  };
}

export function createNoOpMetricsCollector(): MetricsCollector {
  return {
    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op
    increment(): void {},
    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op
    histogram(): void {},
    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op
    gauge(): void {},
    // biome-ignore lint/suspicious/noEmptyBlockStatements: no-op
    timing(): void {},
  };
}
