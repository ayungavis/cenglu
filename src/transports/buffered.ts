import type {
  AsyncTransport,
  LogRecord,
  Transport,
  TransportOptions,
} from "../types";

interface BufferedTransportOptions extends TransportOptions {
  transport: Transport | AsyncTransport;
  bufferSize?: number;
  flushInterval?: number;
  maxBatchSize?: number;
  onBufferFull?: (records: LogRecord[]) => void;
  enableCompression?: boolean;
}

export class BufferedTransport implements AsyncTransport {
  private buffer: Array<{
    record: LogRecord;
    formatted: string;
    isError: boolean;
  }> = [];
  private transport: Transport | AsyncTransport;
  private options: {
    bufferSize: number;
    flushInterval: number;
    maxBatchSize: number;
    enableCompression: boolean;
    onBufferFull?: (records: LogRecord[]) => void;
    errorHandler?: (error: Error, record: LogRecord) => void;
    retryAttempts: number;
    retryDelay: number;
    timeout: number;
  };
  private flushTimer?: NodeJS.Timeout;
  private isFlushing = false;
  private pendingFlush?: Promise<void>;
  private stats = {
    recordsBuffered: 0,
    batchesFlushed: 0,
    recordsFlushed: 0,
    flushErrors: 0,
  };

  constructor(options: BufferedTransportOptions) {
    this.transport = options.transport;
    this.options = {
      bufferSize: options.bufferSize ?? 1000,
      flushInterval: options.flushInterval ?? 5000,
      maxBatchSize: options.maxBatchSize ?? 100,
      enableCompression: options.enableCompression ?? false,
      onBufferFull: options.onBufferFull,
      errorHandler: options.errorHandler,
      retryAttempts: options.retryAttempts ?? 3,
      retryDelay: options.retryDelay ?? 1000,
      timeout: options.timeout ?? 10000,
    };

    this.startFlushTimer();
  }

  async write(
    rec: LogRecord,
    formatted: string,
    isError: boolean,
  ): Promise<void> {
    // Add to buffer
    this.buffer.push({ record: rec, formatted, isError });
    this.stats.recordsBuffered++;

    // Check if buffer is full
    if (this.buffer.length >= this.options.bufferSize) {
      if (this.options.onBufferFull) {
        this.options.onBufferFull(this.buffer.map((b) => b.record));
      }

      // Force flush when buffer is full
      await this.flush();
    } else if (this.buffer.length >= this.options.maxBatchSize) {
      // Flush a batch when we have enough records
      this.scheduleFlush();
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0 && !this.isFlushing) {
        this.flush().catch((err) => {
          this.stats.flushErrors++;
          if (this.options.errorHandler) {
            // Call error handler for each record in buffer
            for (const { record } of this.buffer) {
              this.options.errorHandler(err as Error, record);
            }
          }
        });
      }
    }, this.options.flushInterval);
  }

  private scheduleFlush(): void {
    // Schedule an immediate flush if not already flushing
    if (!this.isFlushing && !this.pendingFlush) {
      this.pendingFlush = Promise.resolve().then(() => this.flush());
    }
  }

  async flush(): Promise<void> {
    if (this.isFlushing || this.buffer.length === 0) {
      return this.pendingFlush || Promise.resolve();
    }

    this.isFlushing = true;
    this.pendingFlush = this.doFlush();

    try {
      await this.pendingFlush;
    } finally {
      this.isFlushing = false;
      this.pendingFlush = undefined;
    }
  }

  private async doFlush(): Promise<void> {
    const batches = this.createBatches();

    for (const batch of batches) {
      try {
        await this.flushBatch(batch);
        this.stats.batchesFlushed++;
        this.stats.recordsFlushed += batch.length;
      } catch (error) {
        this.stats.flushErrors++;

        // Put records back if flush failed
        this.buffer.unshift(...batch);

        if (this.options.errorHandler) {
          for (const { record } of batch) {
            this.options.errorHandler(error as Error, record);
          }
        }

        throw error;
      }
    }
  }

  private createBatches(): Array<
    Array<{ record: LogRecord; formatted: string; isError: boolean }>
  > {
    const batches: Array<
      Array<{ record: LogRecord; formatted: string; isError: boolean }>
    > = [];
    const records = [...this.buffer];
    this.buffer = [];

    while (records.length > 0) {
      const batchSize = Math.min(this.options.maxBatchSize, records.length);
      batches.push(records.splice(0, batchSize));
    }

    return batches;
  }

  private async flushBatch(
    batch: Array<{ record: LogRecord; formatted: string; isError: boolean }>,
  ): Promise<void> {
    // Write batch with retry logic
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= this.options.retryAttempts; attempt++) {
      try {
        if (this.options.enableCompression && batch.length > 10) {
          // For large batches, consider compression (would need zlib)
          await this.writeBatchCompressed(batch);
        } else {
          await this.writeBatch(batch);
        }
        return;
      } catch (error) {
        lastError = error as Error;

        if (attempt < this.options.retryAttempts) {
          // Exponential backoff
          const delay = this.options.retryDelay * 2 ** attempt;
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error("Failed to flush batch after retries");
  }

  private async writeBatch(
    batch: Array<{ record: LogRecord; formatted: string; isError: boolean }>,
  ): Promise<void> {
    // Check if transport is async
    const isAsync = "then" in this.transport.write;

    for (const { record, formatted, isError } of batch) {
      if (isAsync) {
        await (this.transport as AsyncTransport).write(
          record,
          formatted,
          isError,
        );
      } else {
        (this.transport as Transport).write(record, formatted, isError);
      }
    }
  }

  private async writeBatchCompressed(
    batch: Array<{ record: LogRecord; formatted: string; isError: boolean }>,
  ): Promise<void> {
    // This would require zlib for compression
    // For now, just use regular write
    await this.writeBatch(batch);
  }

  private sleep(ms: number): Promise<void> {
    return new Promise((resolve) => setTimeout(resolve, ms));
  }

  async close(): Promise<void> {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    // Final flush
    await this.flush();

    // Close underlying transport
    if (this.transport.close) {
      await this.transport.close();
    }
  }

  getStats(): typeof this.stats {
    return { ...this.stats };
  }

  onError?: (error: Error, record: LogRecord) => void;
}

/**
 * Create a buffered transport wrapper
 */
export function createBufferedTransport(
  transport: Transport | AsyncTransport,
  options?: Partial<Omit<BufferedTransportOptions, "transport">>,
): BufferedTransport {
  return new BufferedTransport({ transport, ...options });
}
