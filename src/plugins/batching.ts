import type { LoggerPlugin, LogRecord } from "../types";

export type BatchingPluginOptions = {
  maxBatchSize?: number;
  maxWaitMs?: number;
  onBatch: (records: LogRecord[]) => void | Promise<void>;
  flushOnError?: boolean;
  maxRetries?: number;
  retryDelay?: number;
  onBatchError?: (error: Error, records: LogRecord[]) => void;
  transform?: (records: LogRecord[]) => unknown;
};

/**
 * Plugin that batches log records before sending
 *
 * This is useful for reducing the number of network calls when
 * sending logs to external services.
 *
 * @example
 * const logger = createLogger({
 *   plugins: [
 *     batchingPlugin({
 *       maxBatchSize: 100,
 *       maxWaitMs: 5000,
 *       onBatch: async (records) => {
 *         await fetch("https://logs.example.com/ingest", {
 *           method: "POST",
 *           body: JSON.stringify(records),
 *         });
 *       },
 *     }),
 *   ],
 * });
 */
export function batchingPlugin(options: BatchingPluginOptions): LoggerPlugin {
  const {
    maxBatchSize = 100,
    maxWaitMs = 5000,
    onBatch,
    flushOnError = true,
    maxRetries = 3,
    retryDelay = 1000,
    onBatchError,
    transform,
  } = options;

  let batch: LogRecord[] = [];
  let timer: NodeJS.Timeout | null = null;
  let isFlushing = false;
  let pendingFlush: Promise<void> | null = null;

  function sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: needed for the logic
  async function sendBatch(records: LogRecord[]): Promise<void> {
    const payload = transform ? transform(records) : records;
    let lastError: Error | null = null;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await onBatch(payload as LogRecord[]);
        return;
      } catch (err) {
        lastError = err instanceof Error ? err : new Error(String(err));

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = retryDelay * 2 ** attempt;
          await sleep(delay);
        }
      }
    }

    // All retries failed
    if (lastError) {
      if (onBatchError) {
        onBatchError(lastError, records);
      } else {
        process.stderr.write(
          `[cenglu:batching] Batch failed after ${maxRetries} retries: ${lastError.message}\n`
        );
      }
    }
  }

  async function flush(): Promise<void> {
    // Clear timer
    if (timer) {
      clearTimeout(timer);
      timer = null;
    }

    // Skip if empty or already flushing
    if (batch.length === 0) {
      return;
    }

    // If already flushing, wait for it
    if (isFlushing && pendingFlush) {
      await pendingFlush;
      return flush();
    }

    isFlushing = true;

    // Take current batch and clear it
    const toSend = batch;
    batch = [];

    try {
      pendingFlush = sendBatch(toSend);
      await pendingFlush;
    } finally {
      isFlushing = false;
      pendingFlush = null;
    }
  }

  function scheduleFlush(): void {
    if (timer) {
      return;
    }

    timer = setTimeout(() => {
      timer = null;
      flush().catch((err) => {
        process.stderr.write(`[cenglu:batching] Scheduled flush error: ${err}\n`);
      });
    }, maxWaitMs);

    timer.unref();
  }

  return {
    name: "batching",
    order: 95, // Run very late

    onWrite(record: LogRecord): void {
      batch.push(record);

      // Immediate flush on errors if configured
      if (flushOnError && (record.level === "error" || record.level === "fatal")) {
        // biome-ignore lint/suspicious/noEmptyBlockStatements: ignore
        flush().catch(() => {});
        return;
      }

      // Flush if batch is full
      if (batch.length >= maxBatchSize) {
        // biome-ignore lint/suspicious/noEmptyBlockStatements: ignore
        flush().catch(() => {});
        return;
      }

      // Schedule timed flush
      scheduleFlush();
    },

    async onFlush(): Promise<void> {
      await flush();
    },

    async onClose(): Promise<void> {
      await flush();
    },
  };
}

export function httpBatchingPlugin(options: {
  url: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  maxBatchSize?: number;
  maxWaitMs?: number;
  transform?: (records: LogRecord[]) => unknown;
}): LoggerPlugin {
  const {
    url,
    method = "POST",
    headers = { "Content-Type": "application/json" },
    maxBatchSize = 100,
    maxWaitMs = 5000,
    transform,
  } = options;

  return batchingPlugin({
    maxBatchSize,
    maxWaitMs,
    transform,
    onBatch: async (records) => {
      const response = await fetch(url, {
        method,
        headers,
        body: JSON.stringify(records),
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    },
    onBatchError: (error, records) => {
      process.stderr.write(
        `[cenglu:http-batching] Failed to send ${records.length} logs to ${url}: ${error.message}\n`
      );
    },
  });
}
