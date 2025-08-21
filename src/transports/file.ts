import { spawn } from "node:child_process";
import {
  createReadStream,
  createWriteStream,
  existsSync,
  mkdirSync,
  readdirSync,
  statSync,
  unlinkSync,
  type WriteStream,
} from "node:fs";
import { join } from "node:path";
import { createGzip } from "node:zlib";
import type { FileSinkOptions, LogLevel, LogRecord, Transport } from "../types";

interface StreamHandle {
  level: LogLevel;
  stream: WriteStream;
  periodIndex: number;
  sequence: number;
  bytes: number;
}

const dayMs = 24 * 60 * 60 * 1000;
const floorToDays = (t: number, days: number) =>
  Math.floor(t / (Math.max(1, days) * dayMs));
const ensureDir = (d: string) => {
  if (!existsSync(d)) mkdirSync(d, { recursive: true });
};

export class FileTransport implements Transport {
  private opts: Required<FileSinkOptions>;
  private info?: StreamHandle;
  private err?: StreamHandle;
  private now: () => number;
  private lastCleanupDay = -1;

  constructor(opts: FileSinkOptions = {}, now?: () => number) {
    const rotation = {
      intervalDays: 1,
      maxBytes: 10 * 1024 * 1024,
      maxFilesPerPeriod: 10,
      gzip: false,
      compress: undefined,
      compressedTtlDays: 0,
      ...(opts.rotation || {}),
    };

    if (rotation.gzip && !rotation.compress) rotation.compress = "gzip";

    this.opts = {
      enabled: true,
      dir: process.env.LOG_DIR || "./logs",
      separateError: true,
      filename: ({ date, level, sequence }) => {
        const yyyy = date.getFullYear(),
          mm = String(date.getMonth() + 1).padStart(2, "0"),
          dd = String(date.getDate()).padStart(2, "0");
        const seq = sequence > 0 ? `.${String(sequence).padStart(3, "0")}` : "";
        return `${level}-${yyyy}-${mm}-${dd}${seq}.log`;
      },
      ...opts,
      rotation,
    } as Required<FileSinkOptions>;

    this.now = now || (() => Date.now());
    ensureDir(this.opts.dir);
  }

  private dateFor(idx: number) {
    return new Date((this.opts.rotation.intervalDays || 1) * dayMs * idx);
  }

  private filePath(level: LogLevel, sequence: number, idx: number) {
    const date = this.dateFor(idx);
    const name = this.opts.filename({
      date,
      level,
      periodIndex: idx,
      sequence,
    });

    return join(this.opts.dir, name);
  }

  private open(level: LogLevel, sequence: number, idx: number): StreamHandle {
    const full = this.filePath(level, sequence, idx);

    ensureDir(this.opts.dir);

    const s = createWriteStream(full, { flags: "a" });
    let bytes = 0;

    try {
      bytes = statSync(full).size;
    } catch {}

    return { level, stream: s, periodIndex: idx, sequence, bytes };
  }

  private cleanupCompressedFiles(nowMs: number) {
    const ttl = this.opts.rotation.compressedTtlDays || 0;

    if (ttl <= 0) return;
    const ttlMs = ttl * dayMs;

    for (const f of readdirSync(this.opts.dir).filter(
      (f) => f.endsWith(".gz") || f.endsWith(".lz4"),
    )) {
      try {
        const p = join(this.opts.dir, f);
        const st = statSync(p);
        if (nowMs - st.mtimeMs > ttlMs) unlinkSync(p);
      } catch {}
    }
  }

  private getHandle(level: LogLevel) {
    const t = this.now();
    const idx = floorToDays(t, this.opts.rotation.intervalDays || 1);
    const today = floorToDays(t, 1);

    if (today !== this.lastCleanupDay) {
      this.cleanupCompressedFiles(t);
      this.lastCleanupDay = today;
    }

    const target =
      this.opts.separateError && (level === "error" || level === "fatal")
        ? "err"
        : "info";
    let h = this[target] as StreamHandle | undefined;

    if (!h || h.periodIndex !== idx) {
      if (h) h.stream.close();
      h = this.open(target === "err" ? "error" : "info", 0, idx);
      this[target] = h;
    }

    return h;
  }

  private compressGzip(path: string) {
    const gz = createGzip();
    const out = createWriteStream(`${path}.gz`);

    return new Promise<void>((resolve) => {
      createReadStream(path)
        .pipe(gz)
        .pipe(out)
        .on("finish", () => {
          try {
            unlinkSync(path);
          } catch {}
          resolve();
        })
        .on("error", () => resolve());
    });
  }

  private async compressLz4(path: string) {
    try {
      await new Promise<void>((res) => {
        const cp = spawn("lz4", ["-z", "-f", path, `${path}.lz4`], {
          stdio: "ignore",
        });

        cp.on("close", () => {
          try {
            unlinkSync(path);
          } catch {}
          res();
        });

        cp.on("error", () => res());
      });
    } catch {}
  }

  private async compressOld(path: string) {
    const algo = (
      this.opts.rotation.compress || this.opts.rotation.gzip ? "gzip" : false
    ) as false | "gzip" | "lz4";

    if (!algo) return;
    if (algo === "lz4") await this.compressLz4(path);
    else await this.compressGzip(path);
  }

  private enforceRetention(level: LogLevel, idx: number) {
    const max = this.opts.rotation.maxFilesPerPeriod || 0;

    if (max <= 0) return;

    const d = this.dateFor(idx);
    const yyyy = d.getFullYear(),
      mm = String(d.getMonth() + 1).padStart(2, "0"),
      dd = String(d.getDate()).padStart(2, "0");
    const prefix = `${level}-${yyyy}-${mm}-${dd}`;
    const files = readdirSync(this.opts.dir)
      .filter(
        (f) =>
          f.startsWith(prefix) &&
          (f.endsWith(".log") ||
            f.endsWith(".log.gz") ||
            f.endsWith(".log.lz4")),
      )
      .sort();

    if (files.length <= max) return;

    const remove = files.slice(0, Math.max(0, files.length - max));
    for (const f of remove) {
      try {
        unlinkSync(join(this.opts.dir, f));
      } catch {}
    }
  }

  private rotateIfNeeded(h: StreamHandle, nextBytes: number) {
    const max = this.opts.rotation.maxBytes || Infinity;

    if (h.bytes + nextBytes > max) {
      const old = this.filePath(h.level, h.sequence, h.periodIndex);

      h.stream.close();

      void this.compressOld(old).then(() =>
        this.cleanupCompressedFiles(this.now()),
      );

      const nh = this.open(h.level, h.sequence + 1, h.periodIndex);
      this.enforceRetention(h.level, h.periodIndex);

      if (h.level === "error") this.err = nh;
      else this.info = nh;

      return nh;
    }

    return h;
  }

  write(_rec: LogRecord, formatted: string, isError: boolean) {
    if (!this.opts.enabled) return;

    let h = this.getHandle(isError ? "error" : "info");
    const line = `${formatted}\n`;
    h = this.rotateIfNeeded(h, Buffer.byteLength(line));
    const ok = h.stream.write(line);
    h.bytes += Buffer.byteLength(line);

    if (!ok) h.stream.once("drain", () => {});
  }

  async close() {
    await Promise.all(
      [this.info?.stream, this.err?.stream]
        .filter(Boolean)
        .map((s) => new Promise<void>((res) => s?.end(res))),
    );
  }
}
