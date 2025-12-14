import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  type WriteStream,
} from "fs";
import { basename, dirname, join } from "path";
import { pipeline } from "stream/promises";
import { createGzip } from "zlib";
import type { FileOptions, FileRotationPolicy, LogLevel, LogRecord, Transport } from "../types";

type FileTransportConfig = {
  enabled: boolean;
  dir: string;
  separateErrors: boolean;
  filename: (info: { date: Date; level: LogLevel; sequence: number }) => string;
  rotation: Required<FileRotationPolicy>;
};

type StreamState = {
  stream: WriteStream;
  path: string;
  bytes: number;
  dayIndex: number;
  sequence: number;
  writable: boolean;
};

const DAY_MS = 86_400_000; // 24 * 60 * 60 * 1000
const DEFAULT_MAX_BYTES = 10 * 1024 * 1024; // 10 MB
const DEFAULT_MAX_FILES = 10;
const DEFAULT_INTERVAL_DAYS = 1;

/**
 * Transport that writes logs to files with rotation support
 *
 * Features:
 * - Automatic file rotation by size and time
 * - Optional gzip compression of rotated files
 * - Separate error log files
 * - Retention policy for old files
 * - Graceful handling of disk errors
 *
 * @example
 * const transport = new FileTransport({
 *   dir: "./logs",
 *   separateErrors: true,
 *   rotation: {
 *     maxBytes: 10 * 1024 * 1024, // 10 MB
 *     intervalDays: 1,
 *     maxFiles: 10,
 *     compress: "gzip",
 *     retentionDays: 30,
 *   },
 * });
 */
export class FileTransport implements Transport {
  private readonly config: FileTransportConfig;
  private readonly now: () => number;

  private infoStream: StreamState | null = null;
  private errorStream: StreamState | null = null;
  private lastCleanupDay = -1;
  private closed = false;
  private pendingWrites = 0;

  constructor(options: FileOptions = {}, now?: () => number) {
    this.now = now ?? Date.now;

    this.config = {
      enabled: options.enabled ?? true,
      dir: options.dir ?? process.env.LOG_DIR ?? "./logs",
      separateErrors: options.separateErrors ?? true,
      filename: options.filename ?? this.defaultFilename,
      rotation: {
        intervalDays: options.rotation?.intervalDays ?? DEFAULT_INTERVAL_DAYS,
        maxBytes: options.rotation?.maxBytes ?? DEFAULT_MAX_BYTES,
        maxFiles: options.rotation?.maxFiles ?? DEFAULT_MAX_FILES,
        compress: options.rotation?.compress ?? false,
        retentionDays: options.rotation?.retentionDays ?? 0,
      },
    };

    // Ensure log directory exists
    this.ensureDirectory(this.config.dir);
  }

  write(_record: LogRecord, formatted: string, isError: boolean): void {
    if (!this.config.enabled || this.closed) {
      return;
    }

    try {
      const level = isError ? "error" : "info";
      const state = this.getOrCreateStream(level, isError);

      // biome-ignore lint/complexity/useOptionalChain: intentional
      if (!(state && state.writable)) {
        return;
      }

      // biome-ignore lint/style/useTemplate: intentional
      const line = formatted + "\n";
      const lineBytes = Buffer.byteLength(line, "utf8");

      // Check if rotation is needed before writing
      if (this.needsRotation(state, lineBytes)) {
        this.rotateStream(state, level);
      }

      // Write to stream
      this.pendingWrites += 1;
      const written = state.stream.write(line, () => {
        this.pendingWrites -= 1;
      });

      state.bytes += lineBytes;

      // Handle backpressure
      if (!written) {
        state.stream.once("drain", () => {
          // Ready for more writes
        });
      }
    } catch (err) {
      // Log file errors shouldn't crash the application
      this.handleError(err);
    }
  }

  async flush(): Promise<void> {
    const streams = [this.infoStream, this.errorStream].filter(Boolean) as StreamState[];

    // Wait for pending writes to complete
    if (this.pendingWrites > 0) {
      await new Promise<void>((resolve) => {
        const check = () => {
          if (this.pendingWrites === 0) {
            resolve();
          } else {
            setImmediate(check);
          }
        };
        check();
      });
    }

    // Drain all streams
    await Promise.all(streams.map((state) => this.drainStream(state.stream)));
  }

  async close(): Promise<void> {
    if (this.closed) {
      return;
    }
    this.closed = true;

    // Flush pending writes
    await this.flush();

    // Close streams
    const closePromises: Promise<void>[] = [];

    if (this.infoStream) {
      closePromises.push(this.closeStream(this.infoStream.stream));
      this.infoStream = null;
    }

    if (this.errorStream) {
      closePromises.push(this.closeStream(this.errorStream.stream));
      this.errorStream = null;
    }

    await Promise.all(closePromises);
  }

  private getOrCreateStream(_level: LogLevel, isError: boolean): StreamState | null {
    const timestamp = this.now();
    const dayIndex = this.getDayIndex(timestamp);

    // Run cleanup once per day
    const todayIndex = Math.floor(timestamp / DAY_MS);
    if (todayIndex !== this.lastCleanupDay) {
      this.runCleanup(timestamp);
      this.lastCleanupDay = todayIndex;
    }

    // Determine which stream to use
    const useErrorStream = this.config.separateErrors && isError;
    const currentState = useErrorStream ? this.errorStream : this.infoStream;
    const streamLevel = useErrorStream ? "error" : "info";

    // Check if we need a new stream (new day or first write)
    if (!currentState || currentState.dayIndex !== dayIndex) {
      // Close old stream if it exists
      if (currentState) {
        // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional
        this.closeStream(currentState.stream).catch(() => {});
      }

      // Create new stream
      const newState = this.createStream(streamLevel as LogLevel, dayIndex);

      if (useErrorStream) {
        this.errorStream = newState;
      } else {
        this.infoStream = newState;
      }

      return newState;
    }

    return currentState;
  }

  private createStream(level: LogLevel, dayIndex: number, sequence = 0): StreamState {
    const date = this.getDateForDayIndex(dayIndex);
    const filename = this.config.filename({ date, level, sequence });
    const filepath = join(this.config.dir, filename);

    // Ensure directory exists
    this.ensureDirectory(dirname(filepath));

    // Get current file size if file exists
    let bytes = 0;
    try {
      if (existsSync(filepath)) {
        bytes = statSync(filepath).size;
      }
    } catch {
      // File doesn't exist or can't be read, start fresh
    }

    // Create write stream (append mode)
    const stream = createWriteStream(filepath, {
      flags: "a",
      encoding: "utf8",
    });

    // Handle stream errors
    stream.on("error", (err) => {
      this.handleError(err);
    });

    const state: StreamState = {
      stream,
      path: filepath,
      bytes,
      dayIndex,
      sequence,
      writable: true,
    };

    // Track writable state
    stream.on("close", () => {
      state.writable = false;
    });

    stream.on("error", () => {
      state.writable = false;
    });

    return state;
  }

  private needsRotation(state: StreamState, additionalBytes: number): boolean {
    const maxBytes = this.config.rotation.maxBytes;
    return maxBytes > 0 && state.bytes + additionalBytes > maxBytes;
  }

  private rotateStream(state: StreamState, level: LogLevel): void {
    const oldPath = state.path;
    const dayIndex = state.dayIndex;
    const newSequence = state.sequence + 1;

    // Close current stream
    state.stream.end();
    state.writable = false;

    // Compress old file asynchronously
    if (this.config.rotation.compress === "gzip") {
      // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional
      this.compressFile(oldPath).catch(() => {});
    }

    // Create new stream with incremented sequence
    const newState = this.createStream(level as LogLevel, dayIndex, newSequence);

    // Update reference
    if (level === "error") {
      this.errorStream = newState;
    } else {
      this.infoStream = newState;
    }

    // Enforce file count limits
    this.enforceMaxFiles(level as LogLevel, dayIndex);
  }

  private async compressFile(filepath: string): Promise<void> {
    if (!existsSync(filepath)) {
      return;
    }

    const gzPath = `${filepath}.gz`;

    try {
      const source = createReadStream(filepath);
      const destination = createWriteStream(gzPath);
      const gzip = createGzip();

      await pipeline(source, gzip, destination);

      // Remove original file after successful compression
      unlinkSync(filepath);
    } catch (err) {
      this.handleError(err);

      // Clean up partial gz file if it exists
      try {
        if (existsSync(gzPath)) {
          unlinkSync(gzPath);
        }
        // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional
      } catch {}
    }
  }

  private enforceMaxFiles(level: LogLevel, dayIndex: number): void {
    const maxFiles = this.config.rotation.maxFiles;
    if (maxFiles <= 0) {
      return;
    }

    try {
      const date = this.getDateForDayIndex(dayIndex);
      const prefix = this.getFilenamePrefix(level, date);

      const files = readdirSync(this.config.dir)
        .filter((f) => f.startsWith(prefix) && (f.endsWith(".log") || f.endsWith(".gz")))
        .sort();

      if (files.length > maxFiles) {
        const toRemove = files.slice(0, files.length - maxFiles);
        for (const file of toRemove) {
          try {
            unlinkSync(join(this.config.dir, file));
            // biome-ignore lint/suspicious/noEmptyBlockStatements: intentional
          } catch {}
        }
      }
    } catch (err) {
      this.handleError(err);
    }
  }

  private runCleanup(timestamp: number): void {
    const retentionDays = this.config.rotation.retentionDays;
    if (retentionDays <= 0) {
      return;
    }

    const cutoffTime = timestamp - retentionDays * DAY_MS;

    try {
      const files = readdirSync(this.config.dir);

      for (const file of files) {
        if (!(file.endsWith(".log") || file.endsWith(".gz"))) {
          continue;
        }

        const filepath = join(this.config.dir, file);

        try {
          const stat = statSync(filepath);
          if (stat.mtimeMs < cutoffTime) {
            unlinkSync(filepath);
          }
        } catch {
          // File might have been deleted, ignore
        }
      }
    } catch (err) {
      this.handleError(err);
    }
  }

  // biome-ignore lint/style/useReadonlyClassProperties: intentional
  private defaultFilename = (info: { date: Date; level: LogLevel; sequence: number }): string => {
    const year = info.date.getFullYear();
    const month = String(info.date.getMonth() + 1).padStart(2, "0");
    const day = String(info.date.getDate()).padStart(2, "0");

    const seq = info.sequence > 0 ? `.${String(info.sequence).padStart(3, "0")}` : "";

    return `${info.level}-${year}-${month}-${day}${seq}.log`;
  };

  private getFilenamePrefix(level: LogLevel, date: Date): string {
    const year = date.getFullYear();
    const month = String(date.getMonth() + 1).padStart(2, "0");
    const day = String(date.getDate()).padStart(2, "0");

    return `${level}-${year}-${month}-${day}`;
  }

  private getDayIndex(timestamp: number): number {
    const intervalDays = this.config.rotation.intervalDays;
    return Math.floor(timestamp / (intervalDays * DAY_MS));
  }

  private getDateForDayIndex(dayIndex: number): Date {
    const intervalDays = this.config.rotation.intervalDays;
    return new Date(dayIndex * intervalDays * DAY_MS);
  }

  private ensureDirectory(dir: string): void {
    if (!existsSync(dir)) {
      mkdirSync(dir, { recursive: true });
    }
  }

  private drainStream(stream: WriteStream): Promise<void> {
    return new Promise((resolve) => {
      if (stream.writableNeedDrain) {
        stream.once("drain", () => resolve());
      } else {
        resolve();
      }
    });
  }

  private closeStream(stream: WriteStream): Promise<void> {
    return new Promise((resolve) => {
      stream.end(() => resolve());
    });
  }

  private handleError(err: unknown): void {
    const message = err instanceof Error ? err.message : String(err);
    process.stderr.write(`[cenglu:FileTransport] Error: ${message}\n`);
  }
}

export type RotatingFileOptions = {
  path: string;
  maxSize?: number | string;
  maxFiles?: number;
  compress?: boolean;
  datePattern?: string;
  rotateDatePattern?: boolean;
};

function parseSize(size: number | string): number {
  if (typeof size === "number") {
    return size;
  }

  // biome-ignore lint/performance/useTopLevelRegex: intentional
  const match = size.match(/^(\d+(?:\.\d+)?)\s*([kmg])?b?$/i);
  if (!match) {
    return Number.parseInt(size, 10);
  }

  const value = Number.parseFloat(match[1] ?? "0");
  const unit = (match[2] ?? "").toLowerCase();

  switch (unit) {
    case "k":
      return value * 1024;
    case "m":
      return value * 1024 * 1024;
    case "g":
      return value * 1024 * 1024 * 1024;
    default:
      return value;
  }
}

/**
 * Create a rotating file transport with simpler configuration
 *
 * @example
 * const transport = createRotatingFileTransport({
 *   path: "./logs/app-%DATE%.log",
 *   maxSize: "10m",
 *   maxFiles: 14,
 *   compress: true,
 * });
 */
export function createRotatingFileTransport(options: RotatingFileOptions): FileTransport {
  const dir = dirname(options.path);
  const filenamePattern = basename(options.path);

  // Parse maxSize
  const maxBytes = options.maxSize ? parseSize(options.maxSize) : DEFAULT_MAX_BYTES;

  return new FileTransport({
    enabled: true,
    dir,
    separateErrors: false,
    filename: ({ date, sequence }) => {
      // Replace date placeholder
      let name = filenamePattern;

      const year = date.getFullYear();
      const month = String(date.getMonth() + 1).padStart(2, "0");
      const day = String(date.getDate()).padStart(2, "0");

      name = name.replace(/%DATE%/g, `${year}-${month}-${day}`);
      name = name.replace(/%YEAR%/g, String(year));
      name = name.replace(/%MONTH%/g, month);
      name = name.replace(/%DAY%/g, day);

      // Add sequence number if needed
      if (sequence > 0) {
        const ext = name.lastIndexOf(".");
        if (ext > 0) {
          name = `${name.slice(0, ext)}.${sequence}${name.slice(ext)}`;
        } else {
          name = `${name}.${sequence}`;
        }
      }

      return name;
    },
    rotation: {
      intervalDays: 1,
      maxBytes,
      maxFiles: options.maxFiles ?? DEFAULT_MAX_FILES,
      compress: options.compress ? "gzip" : false,
    },
  });
}

export function createFileTransport(options?: FileOptions, now?: () => number): FileTransport {
  return new FileTransport(options, now);
}

export { FileTransport as default };
