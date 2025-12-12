import type { LoggerPlugin, LogLevel, LogRecord } from "../types";

export type RateLimitPluginOptions = {
  maxLogs: number;
  windowMs?: number;
  excludeLevels?: LogLevel[];
  onLimitReached?: (droppedCount: number, windowMs: number) => void;
  onDrop?: (record: LogRecord) => void;
  logSummary?: boolean;
  keyFn?: (record: LogRecord) => string;
  maxKeys?: number;
};

/**
 * Plugin that rate limits log output to prevent log flooding
 *
 * This is useful for preventing runaway logging from overwhelming
 * your log infrastructure or filling up disk space.
 *
 * @example
 * const logger = createLogger({
 *   plugins: [
 *     rateLimitPlugin({
 *       maxLogs: 1000,      // Max 1000 logs
 *       windowMs: 1000,     // Per second
 *       excludeLevels: ["error", "fatal"], // Always allow errors
 *       onLimitReached: (dropped) => {
 *         console.warn(`Dropped ${dropped} logs due to rate limit`);
 *       },
 *     }),
 *   ],
 * });
 *
 * @example
 * // Per-key rate limiting (e.g., per user)
 * const logger = createLogger({
 *   plugins: [
 *     rateLimitPlugin({
 *       maxLogs: 100,
 *       windowMs: 60000, // Per minute
 *       keyFn: (record) => record.context?.userId as string ?? "anonymous",
 *     }),
 *   ],
 * });
 */
export function rateLimitPlugin(options: RateLimitPluginOptions): LoggerPlugin {
  const {
    maxLogs,
    windowMs = 1000,
    excludeLevels = ["error", "fatal"],
    onLimitReached,
    onDrop,
    logSummary = true,
    keyFn,
    maxKeys = 1000,
  } = options;

  const excludeSet = new Set(excludeLevels);

  // State for global rate limiting
  let globalCount = 0;
  let globalWindowStart = Date.now();
  let globalDroppedInWindow = 0;

  // State for per-key rate limiting
  const keyStates = new Map<
    string,
    {
      count: number;
      windowStart: number;
      droppedInWindow: number;
    }
  >();

  function resetGlobalWindow(): void {
    if (globalDroppedInWindow > 0) {
      if (onLimitReached) {
        onLimitReached(globalDroppedInWindow, windowMs);
      }
      if (logSummary) {
        process.stderr.write(
          `[cenglu:rate-limit] Dropped ${globalDroppedInWindow} logs in the last ${windowMs}ms\n`
        );
      }
    }
    globalCount = 0;
    globalDroppedInWindow = 0;
    globalWindowStart = Date.now();
  }

  function checkGlobalLimit(record: LogRecord, now: number): boolean {
    // Check if window has expired
    if (now - globalWindowStart >= windowMs) {
      resetGlobalWindow();
    }

    // Check limit
    if (globalCount >= maxLogs) {
      globalDroppedInWindow += 1;
      onDrop?.(record);
      return false;
    }

    globalCount += 1;
    return true;
  }

  function checkKeyLimit(key: string, record: LogRecord, now: number): boolean {
    let state = keyStates.get(key);

    // Create state if doesn't exist
    if (!state) {
      // Evict old keys if at capacity
      if (keyStates.size >= maxKeys) {
        // Remove oldest key (first in map)
        const firstKey = keyStates.keys().next().value;
        if (firstKey) {
          keyStates.delete(firstKey);
        }
      }

      state = {
        count: 0,
        windowStart: now,
        droppedInWindow: 0,
      };
      keyStates.set(key, state);
    }

    // Check if window has expired
    if (now - state.windowStart >= windowMs) {
      if (state.droppedInWindow > 0 && onLimitReached) {
        onLimitReached(state.droppedInWindow, windowMs);
      }
      state.count = 0;
      state.droppedInWindow = 0;
      state.windowStart = now;
    }

    // Check limit
    if (state.count >= maxLogs) {
      state.droppedInWindow += 1;
      onDrop?.(record);
      return false;
    }

    state.count += 1;
    return true;
  }

  return {
    name: "rate-limit",
    order: 1, // Run first to avoid wasted processing

    onRecord(record: LogRecord): LogRecord | null {
      // Don't rate limit excluded levels
      if (excludeSet.has(record.level)) {
        return record;
      }

      const now = Date.now();

      // Use per-key or global rate limiting
      if (keyFn) {
        const key = keyFn(record);
        if (!checkKeyLimit(key, record, now)) {
          return null;
        }
      } else if (!checkGlobalLimit(record, now)) {
        return null;
      }

      return record;
    },

    onClose(): void {
      // Final summary
      if (globalDroppedInWindow > 0) {
        if (onLimitReached) {
          onLimitReached(globalDroppedInWindow, windowMs);
        }
        if (logSummary) {
          process.stderr.write(
            `[cenglu:rate-limit] Final: Dropped ${globalDroppedInWindow} logs\n`
          );
        }
      }
    },
  };
}

/**
 * Create a token bucket rate limiter plugin
 *
 * This provides smoother rate limiting than the fixed window approach.
 * Tokens are added at a constant rate, and each log consumes one token.
 */
export function tokenBucketPlugin(options: {
  bucketSize: number;
  refillRate: number;
  excludeLevels?: LogLevel[];
  onDrop?: (record: LogRecord) => void;
}): LoggerPlugin {
  const { bucketSize, refillRate, excludeLevels = ["error", "fatal"], onDrop } = options;

  const excludeSet = new Set(excludeLevels);

  let tokens = bucketSize;
  let lastRefill = Date.now();

  function refill(): void {
    const now = Date.now();
    const elapsed = (now - lastRefill) / 1000; // Convert to seconds
    const newTokens = elapsed * refillRate;

    tokens = Math.min(bucketSize, tokens + newTokens);
    lastRefill = now;
  }

  return {
    name: "token-bucket",
    order: 1,

    onRecord(record: LogRecord): LogRecord | null {
      // Don't rate limit excluded levels
      if (excludeSet.has(record.level)) {
        return record;
      }

      // Refill tokens
      refill();

      // Check if we have a token
      if (tokens >= 1) {
        tokens -= 1;
        return record;
      }

      // No tokens available
      onDrop?.(record);
      return null;
    },
  };
}
