import type { LoggerPlugin, LogLevel, LogRecord } from "../types";

export type FilterPluginOptions = {
  includeLevels?: LogLevel[];
  excludeLevels?: LogLevel[];
  includeMessages?: (string | RegExp)[];
  excludeMessages?: (string | RegExp)[];
  requireContext?: Record<string, unknown>;
  excludeContext?: Record<string, unknown>;
  filter?: (record: LogRecord) => boolean;
  onDrop?: (record: LogRecord, reason: string) => void;
};

/**
 * Plugin that filters logs based on various criteria
 *
 * @example
 * const logger = createLogger({
 *   plugins: [
 *     filterPlugin({
 *       // Only log info and above
 *       includeLevels: ["info", "warn", "error", "fatal"],
 *
 *       // Exclude health check logs
 *       excludeMessages: [/health.*check/i, "heartbeat"],
 *
 *       // Only log if userId is present
 *       requireContext: { hasUserId: true },
 *
 *       // Custom filter
 *       filter: (record) => {
 *         // Drop logs from internal services
 *         return record.context?.source !== "internal";
 *       },
 *     }),
 *   ],
 * });
 */
export function filterPlugin(options: FilterPluginOptions): LoggerPlugin {
  const {
    includeLevels,
    excludeLevels,
    includeMessages,
    excludeMessages,
    requireContext,
    excludeContext,
    filter,
    onDrop,
  } = options;

  // Convert to sets for fast lookup
  const includeLevelSet = includeLevels ? new Set(includeLevels) : null;
  const excludeLevelSet = excludeLevels ? new Set(excludeLevels) : null;

  function matchesPatterns(msg: string, patterns: (string | RegExp)[]): boolean {
    return patterns.some((pattern) => {
      if (typeof pattern === "string") {
        return msg.includes(pattern);
      }
      return pattern.test(msg);
    });
  }

  function matchesContext(
    context: Record<string, unknown> | undefined,
    required: Record<string, unknown>
  ): boolean {
    if (!context) {
      return false;
    }

    for (const [key, value] of Object.entries(required)) {
      if (context[key] !== value) {
        return false;
      }
    }

    return true;
  }

  function hasExcludedContext(
    context: Record<string, unknown> | undefined,
    excluded: Record<string, unknown>
  ): boolean {
    if (!context) {
      return false;
    }

    for (const [key, value] of Object.entries(excluded)) {
      if (context[key] === value) {
        return true;
      }
    }

    return false;
  }

  return {
    name: "filter",
    order: 3, // Run early, after rate limiting but before other processing

    onRecord(record: LogRecord): LogRecord | null {
      // Check level whitelist
      if (includeLevelSet && !includeLevelSet.has(record.level)) {
        onDrop?.(record, `Level ${record.level} not in include list`);
        return null;
      }

      // Check level blacklist
      if (excludeLevelSet?.has(record.level)) {
        onDrop?.(record, `Level ${record.level} in exclude list`);
        return null;
      }

      // Check message whitelist
      if (includeMessages && !matchesPatterns(record.msg, includeMessages)) {
        onDrop?.(record, "Message does not match include patterns");
        return null;
      }

      // Check message blacklist
      if (excludeMessages && matchesPatterns(record.msg, excludeMessages)) {
        onDrop?.(record, "Message matches exclude pattern");
        return null;
      }

      // Check required context
      if (requireContext && !matchesContext(record.context, requireContext)) {
        onDrop?.(record, "Required context not present");
        return null;
      }

      // Check excluded context
      if (excludeContext && hasExcludedContext(record.context, excludeContext)) {
        onDrop?.(record, "Excluded context present");
        return null;
      }

      // Custom filter
      if (filter && !filter(record)) {
        onDrop?.(record, "Rejected by custom filter");
        return null;
      }

      return record;
    },
  };
}

/**
 * Create a filter plugin that only logs during specific time windows
 *
 * Useful for verbose logging during off-peak hours
 */
export function timeWindowFilterPlugin(options: {
  startHour: number;
  endHour: number;
  timezoneOffset?: number;
  invert?: boolean;
  alwaysLogLevels?: LogLevel[];
}): LoggerPlugin {
  const {
    startHour,
    endHour,
    timezoneOffset,
    invert = false,
    alwaysLogLevels = ["error", "fatal"],
  } = options;

  const alwaysLogSet = new Set(alwaysLogLevels);

  function isInWindow(): boolean {
    const now = new Date();
    let hour = now.getHours();

    if (timezoneOffset !== undefined) {
      hour = (hour + timezoneOffset) % 24;
      if (hour < 0) {
        hour += 24;
      }
    }

    const inWindow =
      startHour <= endHour
        ? hour >= startHour && hour < endHour
        : hour >= startHour || hour < endHour;

    return invert ? !inWindow : inWindow;
  }

  return {
    name: "time-window-filter",
    order: 2,

    onRecord(record: LogRecord): LogRecord | null {
      // Always log certain levels
      if (alwaysLogSet.has(record.level)) {
        return record;
      }

      // Check time window
      if (!isInWindow()) {
        return null;
      }

      return record;
    },
  };
}
