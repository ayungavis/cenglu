import type { AsyncTransport, LogRecord, TransportOptions } from "../types";

interface HttpTransportOptions extends TransportOptions {
  url: string;
  method?: "POST" | "PUT";
  headers?: Record<string, string>;
  batchSize?: number;
  flushInterval?: number;
  maxRetries?: number;
  retryDelay?: number;
  timeout?: number;
  circuitBreaker?: {
    threshold: number;
    resetTimeout: number;
  };
  transform?: (records: LogRecord[]) => unknown;
  auth?: {
    type: "basic" | "bearer" | "apikey";
    credentials: string;
    headerName?: string;
  };
}

interface CircuitBreakerState {
  failures: number;
  lastFailureTime?: number;
  state: "closed" | "open" | "half-open";
}

export class HttpTransport implements AsyncTransport {
  private options: Required<HttpTransportOptions>;
  private buffer: LogRecord[] = [];
  private flushTimer?: NodeJS.Timeout;
  private circuitBreaker: CircuitBreakerState = {
    failures: 0,
    state: "closed",
  };
  private isFlushing = false;

  constructor(options: HttpTransportOptions) {
    this.options = {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      batchSize: 100,
      flushInterval: 5000,
      maxRetries: 3,
      retryDelay: 1000,
      timeout: 10000,
      circuitBreaker: {
        threshold: 5,
        resetTimeout: 60000,
      },
      transform: (records) => records,
      ...options,
      url: options.url,
    } as Required<HttpTransportOptions>;

    // Add auth headers if configured
    if (this.options.auth) {
      this.setupAuthHeaders();
    }

    // Start flush timer
    this.startFlushTimer();
  }

  private setupAuthHeaders(): void {
    const { auth } = this.options;
    if (!auth) return;

    switch (auth.type) {
      case "basic":
        this.options.headers.Authorization = `Basic ${auth.credentials}`;
        break;
      case "bearer":
        this.options.headers.Authorization = `Bearer ${auth.credentials}`;
        break;
      case "apikey": {
        const headerName = auth.headerName || "X-API-Key";
        this.options.headers[headerName] = auth.credentials;
        break;
      }
    }
  }

  async write(
    rec: LogRecord,
    _formatted: string,
    _isError: boolean,
  ): Promise<void> {
    // Check circuit breaker
    if (this.isCircuitOpen()) {
      this.onError?.(new Error("Circuit breaker is open"), rec);
      return;
    }

    // Add to buffer
    this.buffer.push(rec);

    // Flush if buffer is full
    if (this.buffer.length >= this.options.batchSize) {
      await this.flush();
    }
  }

  private isCircuitOpen(): boolean {
    const { state, lastFailureTime } = this.circuitBreaker;
    const { resetTimeout } = this.options.circuitBreaker;

    if (state === "open") {
      // Check if we should transition to half-open
      if (lastFailureTime && Date.now() - lastFailureTime > resetTimeout) {
        this.circuitBreaker.state = "half-open";
        return false;
      }
      return true;
    }

    return false;
  }

  private handleCircuitBreakerSuccess(): void {
    if (this.circuitBreaker.state === "half-open") {
      this.circuitBreaker.state = "closed";
      this.circuitBreaker.failures = 0;
    }
  }

  private handleCircuitBreakerFailure(): void {
    this.circuitBreaker.failures++;
    this.circuitBreaker.lastFailureTime = Date.now();

    if (this.circuitBreaker.failures >= this.options.circuitBreaker.threshold) {
      this.circuitBreaker.state = "open";
    }
  }

  private startFlushTimer(): void {
    if (this.flushTimer) {
      clearInterval(this.flushTimer);
    }

    this.flushTimer = setInterval(() => {
      if (this.buffer.length > 0 && !this.isFlushing) {
        this.flush().catch((err) => {
          console.error("Failed to flush logs:", err);
        });
      }
    }, this.options.flushInterval);
  }

  async flush(): Promise<void> {
    if (this.buffer.length === 0 || this.isFlushing) {
      return;
    }

    this.isFlushing = true;
    const records = [...this.buffer];
    this.buffer = [];

    try {
      await this.sendWithRetry(records);
      this.handleCircuitBreakerSuccess();
    } catch (error) {
      this.handleCircuitBreakerFailure();

      // Put records back in buffer for retry
      this.buffer.unshift(...records);

      // Call error handler for each record
      if (this.onError) {
        for (const record of records) {
          this.onError(error as Error, record);
        }
      }
    } finally {
      this.isFlushing = false;
    }
  }

  private async sendWithRetry(records: LogRecord[]): Promise<void> {
    const { maxRetries, retryDelay } = this.options;
    let lastError: Error | undefined;

    for (let attempt = 0; attempt <= maxRetries; attempt++) {
      try {
        await this.send(records);
        return;
      } catch (error) {
        lastError = error as Error;

        if (attempt < maxRetries) {
          // Exponential backoff
          const delay = retryDelay * 2 ** attempt;
          await this.sleep(delay);
        }
      }
    }

    throw lastError || new Error("Failed to send logs after retries");
  }

  private async send(records: LogRecord[]): Promise<void> {
    const body = this.options.transform(records);

    const controller = new AbortController();
    const timeoutId = setTimeout(
      () => controller.abort(),
      this.options.timeout,
    );

    try {
      const response = await fetch(this.options.url, {
        method: this.options.method,
        headers: this.options.headers,
        body: JSON.stringify(body),
        signal: controller.signal,
      });

      if (!response.ok) {
        throw new Error(`HTTP ${response.status}: ${response.statusText}`);
      }
    } finally {
      clearTimeout(timeoutId);
    }
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
  }

  onError?: (error: Error, record: LogRecord) => void;
}

/**
 * Create HTTP transport with common service configurations
 */
export function createHttpTransport(
  service: "datadog" | "splunk" | "elasticsearch" | "custom",
  options: Partial<HttpTransportOptions> & { url?: string; apiKey?: string },
): HttpTransport {
  const baseOptions: Partial<HttpTransportOptions> = {};

  switch (service) {
    case "datadog":
      baseOptions.url =
        options.url || "https://http-intake.logs.datadoghq.com/v1/input";
      baseOptions.headers = {
        "Content-Type": "application/json",
        "DD-API-KEY": options.apiKey || "",
      };
      baseOptions.transform = (records) =>
        records.map((rec) => ({
          ...rec,
          ddsource: "nodejs",
          service: rec.service,
          hostname: process.env.HOSTNAME,
        }));
      break;

    case "splunk":
      baseOptions.url =
        options.url || "https://localhost:8088/services/collector";
      baseOptions.headers = {
        "Content-Type": "application/json",
        Authorization: `Splunk ${options.apiKey || ""}`,
      };
      baseOptions.transform = (records) =>
        records.map((rec) => ({
          time: Math.floor(rec.time / 1000),
          sourcetype: "_json",
          event: rec,
        }));
      break;

    case "elasticsearch":
      baseOptions.url = options.url || "http://localhost:9200/_bulk";
      baseOptions.headers = {
        "Content-Type": "application/x-ndjson",
      };
      baseOptions.transform = (records) => {
        const bulk: string[] = [];
        for (const rec of records) {
          bulk.push(JSON.stringify({ index: { _index: "logs" } }));
          bulk.push(
            JSON.stringify({
              "@timestamp": new Date(rec.time).toISOString(),
              ...rec,
            }),
          );
        }
        return `${bulk.join("\n")}\n`;
      };
      break;

    case "custom":
      if (!options.url) {
        throw new Error("URL is required for custom HTTP transport");
      }
      baseOptions.url = options.url;
      break;
  }

  return new HttpTransport({
    ...baseOptions,
    ...options,
  } as HttpTransportOptions);
}
