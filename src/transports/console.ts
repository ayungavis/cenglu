import type { ConsoleOptions, LogRecord, Transport } from "../types";

/**
 * Transport that writes logs to the console (stdout/stderr)
 *
 * Features:
 * - Writes to stdout for normal logs, stderr for errors
 * - Configurable output streams
 * - Handles backpressure gracefully
 *
 * @example
 * const transport = new ConsoleTransport({
 *   stream: process.stdout,
 *   errorStream: process.stderr,
 * });
 */
export class ConsoleTransport implements Transport {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;
  private readonly newline: string;

  constructor(options: ConsoleOptions = {}) {
    this.stdout = options.stream ?? process.stdout;
    this.stderr = options.errorStream ?? process.stderr;

    // Use appropriate line ending for the platform
    this.newline = process.platform === "win32" ? "\r\n" : "\n";
  }

  write(_record: LogRecord, formatted: string, isError: boolean): void {
    const stream = isError ? this.stderr : this.stdout;
    const line = formatted + this.newline;

    // Write to stream
    const canContinue = stream.write(line);

    // Handle backpressure
    // In high-throughput scenarios, the stream buffer might fill up
    // We don't block here, but the stream will buffer internally
    if (!canContinue) {
      // Stream is full, but we don't wait - logs will be buffered
      // This is intentional to avoid blocking the main thread
      stream.once("drain", () => {
        // Buffer drained, can continue writing at full speed
      });
    }
  }

  async flush(): Promise<void> {
    await Promise.all([this.flushStream(this.stdout), this.flushStream(this.stderr)]);
  }

  async close(): Promise<void> {
    await this.flush();
  }

  private flushStream(stream: NodeJS.WritableStream): Promise<void> {
    return new Promise((resolve) => {
      // Check if stream needs draining
      if ((stream as NodeJS.WriteStream).writableNeedDrain) {
        stream.once("drain", () => resolve());
      } else {
        resolve();
      }
    });
  }
}

export interface BufferedConsoleOptions extends ConsoleOptions {
  bufferSize?: number;
  flushInterval?: number;
  flushOnExit?: boolean;
}

/**
 * Console transport with internal buffering for high-throughput scenarios
 *
 * Buffers log lines and flushes them periodically or when buffer is full.
 * This reduces the number of write syscalls and improves performance.
 *
 * @example
 * const transport = new BufferedConsoleTransport({
 *   bufferSize: 100,
 *   flushInterval: 1000,
 * });
 */
export class BufferedConsoleTransport implements Transport {
  private readonly stdout: NodeJS.WritableStream;
  private readonly stderr: NodeJS.WritableStream;
  private readonly newline: string;
  private readonly bufferSize: number;
  private readonly flushInterval: number;

  private stdoutBuffer: string[] = [];
  private stderrBuffer: string[] = [];
  private flushTimer: NodeJS.Timeout | null = null;
  private closed = false;

  constructor(options: BufferedConsoleOptions = {}) {
    this.stdout = options.stream ?? process.stdout;
    this.stderr = options.errorStream ?? process.stderr;
    this.newline = process.platform === "win32" ? "\r\n" : "\n";
    this.bufferSize = options.bufferSize ?? 100;
    this.flushInterval = options.flushInterval ?? 1000;

    // Start flush timer
    this.startFlushTimer();

    // Flush on exit if configured
    if (options.flushOnExit ?? true) {
      this.setupExitHandler();
    }
  }

  write(_record: LogRecord, formatted: string, isError: boolean): void {
    if (this.closed) {
      return;
    }

    const line = formatted + this.newline;
    const buffer = isError ? this.stderrBuffer : this.stdoutBuffer;

    buffer.push(line);

    // Flush if buffer is full
    if (buffer.length >= this.bufferSize) {
      this.flushBuffer(isError ? this.stderr : this.stdout, buffer);
      if (isError) {
        this.stderrBuffer = [];
      } else {
        this.stdoutBuffer = [];
      }
    }
  }

  async flush(): Promise<void> {
    if (this.stdoutBuffer.length > 0) {
      this.flushBuffer(this.stdout, this.stdoutBuffer);
      this.stdoutBuffer = [];
    }

    if (this.stderrBuffer.length > 0) {
      this.flushBuffer(this.stderr, this.stderrBuffer);
      this.stderrBuffer = [];
    }

    // Wait for streams to drain
    await Promise.all([this.waitForDrain(this.stdout), this.waitForDrain(this.stderr)]);
  }

  async close(): Promise<void> {
    this.closed = true;

    if (this.flushTimer) {
      clearInterval(this.flushTimer);
      this.flushTimer = null;
    }

    await this.flush();
  }

  private flushBuffer(stream: NodeJS.WritableStream, buffer: string[]): void {
    if (buffer.length === 0) {
      return;
    }

    // Join all lines and write at once
    const data = buffer.join("");
    stream.write(data);
  }

  private startFlushTimer(): void {
    this.flushTimer = setInterval(() => {
      if (this.stdoutBuffer.length > 0 || this.stderrBuffer.length > 0) {
        this.flush().catch(() => {
          // Ignore flush errors in timer
        });
      }
    }, this.flushInterval);

    // Don't keep process alive just for logging
    this.flushTimer.unref();
  }

  private waitForDrain(stream: NodeJS.WritableStream): Promise<void> {
    return new Promise((resolve) => {
      if ((stream as NodeJS.WriteStream).writableNeedDrain) {
        stream.once("drain", () => resolve());
      } else {
        resolve();
      }
    });
  }

  private setupExitHandler(): void {
    const exitHandler = () => {
      // Synchronous flush on exit
      if (this.stdoutBuffer.length > 0) {
        this.flushBuffer(this.stdout, this.stdoutBuffer);
        this.stdoutBuffer = [];
      }
      if (this.stderrBuffer.length > 0) {
        this.flushBuffer(this.stderr, this.stderrBuffer);
        this.stderrBuffer = [];
      }
    };

    process.once("exit", exitHandler);
    process.once("SIGINT", () => {
      exitHandler();
      process.exit(0);
    });
    process.once("SIGTERM", () => {
      exitHandler();
      process.exit(0);
    });
  }
}

export interface PrettyConsoleOptions extends ConsoleOptions {
  colors?: boolean;
  showTimestamp?: boolean;
  showLevel?: boolean;
  timestampFormat?: "iso" | "local" | "relative" | "unix";
}

/**
 * Console transport with pretty formatting built-in
 *
 * This is a convenience transport that combines ConsoleTransport
 * with pretty formatting. Use this when you want colored output
 * without configuring a separate formatter.
 *
 * Note: For most cases, use ConsoleTransport with pretty.enabled = true
 * in the logger options instead.
 */
export class PrettyConsoleTransport implements Transport {
  private readonly inner: ConsoleTransport;
  private readonly colors: boolean;
  private readonly showTimestamp: boolean;
  private readonly showLevel: boolean;
  private readonly timestampFormat: PrettyConsoleOptions["timestampFormat"];

  constructor(options: PrettyConsoleOptions = {}) {
    this.inner = new ConsoleTransport(options);
    this.colors = options.colors ?? this.detectColorSupport();
    this.showTimestamp = options.showTimestamp ?? true;
    this.showLevel = options.showLevel ?? true;
    this.timestampFormat = options.timestampFormat ?? "local";
  }

  write(record: LogRecord, formatted: string, isError: boolean): void {
    // If formatted string already has formatting, use it directly
    // Otherwise, apply simple formatting
    if (formatted.includes("\u001b[")) {
      // Already has ANSI codes, use as-is
      this.inner.write(record, formatted, isError);
    } else {
      // Apply simple formatting
      const prettyLine = this.formatSimple(record);
      this.inner.write(record, prettyLine, isError);
    }
  }

  async flush(): Promise<void> {
    await this.inner.flush();
  }

  async close(): Promise<void> {
    await this.inner.close();
  }

  private formatSimple(record: LogRecord): string {
    const parts: string[] = [];

    // Timestamp
    if (this.showTimestamp) {
      const ts = this.formatTimestamp(record.time);
      parts.push(this.colors ? `\u001b[2m${ts}\u001b[0m` : ts);
    }

    // Level
    if (this.showLevel) {
      const level = record.level.toUpperCase().padEnd(5);
      parts.push(this.colorizeLevel(record.level, level));
    }

    // Message
    parts.push(this.colors ? `\u001b[1m${record.msg}\u001b[0m` : record.msg);

    // Context (simplified)
    if (record.context && Object.keys(record.context).length > 0) {
      const ctx = JSON.stringify(record.context);
      parts.push(this.colors ? `\u001b[2m${ctx}\u001b[0m` : ctx);
    }

    return parts.join(" ");
  }

  private formatTimestamp(time: number): string {
    const date = new Date(time);

    switch (this.timestampFormat) {
      case "iso":
        return date.toISOString();
      case "unix":
        return String(time);
      case "relative": {
        const start = (process as unknown as { startTime?: number }).startTime ?? 0;
        return `+${time - start}ms`;
      }
      default:
        return date.toLocaleTimeString();
    }
  }

  /**
   * Apply color to log level
   */
  private colorizeLevel(level: string, text: string): string {
    if (!this.colors) {
      return text;
    }

    const colors: Record<string, string> = {
      trace: "\u001b[90m", // Gray
      debug: "\u001b[36m", // Cyan
      info: "\u001b[32m", // Green
      warn: "\u001b[33m", // Yellow
      error: "\u001b[31m", // Red
      fatal: "\u001b[35m", // Magenta
    };

    const color = colors[level] || "";
    return `${color}${text}\u001b[0m`;
  }

  private detectColorSupport(): boolean {
    // Check NO_COLOR environment variable
    if (process.env.NO_COLOR !== undefined) {
      return false;
    }

    // Check FORCE_COLOR environment variable
    if (process.env.FORCE_COLOR !== undefined) {
      return process.env.FORCE_COLOR !== "0";
    }

    // Check if stdout is a TTY
    if (process.stdout && typeof process.stdout.isTTY === "boolean") {
      return process.stdout.isTTY;
    }

    return false;
  }
}

export function createConsoleTransport(options?: ConsoleOptions): ConsoleTransport {
  return new ConsoleTransport(options);
}

export function createBufferedConsoleTransport(
  options?: BufferedConsoleOptions
): BufferedConsoleTransport {
  return new BufferedConsoleTransport(options);
}

export { ConsoleTransport as default };
