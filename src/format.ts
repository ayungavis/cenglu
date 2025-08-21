import type { LogRecord, Theme } from "./types";

const code = (n: number) => (s: string) => `\u001b[${n}m${s}\u001b[0m`;
const themeDefaults: Theme = {
  dim: code(2),
  gray: code(90),
  red: code(31),
  yellow: code(33),
  green: code(32),
  cyan: code(36),
  magenta: code(35),
  bold: code(1),
  reset: (s) => s,
};

const levelColor = (lvl: LogRecord["level"], t: Theme = themeDefaults) =>
  ({
    trace: t.gray,
    debug: t.cyan,
    info: t.green,
    warn: t.yellow,
    error: t.red,
    fatal: t.red,
  })[lvl];

export function jsonLine(rec: LogRecord) {
  return JSON.stringify(rec);
}

function p2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function fmt(d: Date) {
  return `${d.getFullYear()}-${p2(d.getMonth() + 1)}-${p2(d.getDate())} ${p2(d.getHours())}:${p2(d.getMinutes())}:${p2(d.getSeconds())}.${String(d.getMilliseconds()).padStart(3, "0")}`;
}

function render(
  obj: Record<string, unknown>,
  acc: string[] = [],
  prefix = "",
  visited = new WeakSet(),
) {
  if (!obj || typeof obj !== "object") return acc;

  // Prevent circular references
  if (visited.has(obj)) {
    return acc;
  }
  visited.add(obj);

  const ent = Object.entries(obj);
  ent.forEach(([k, v], i) => {
    const last = i === ent.length - 1;
    const br = last ? "└─" : "├─";
    const next = prefix + (last ? "  " : "│ ");

    // Handle null/undefined
    if (v === null || v === undefined) {
      acc.push(`${prefix}${br} ${k}: ${v}`);
    }
    // Handle Date objects
    else if (v instanceof Date) {
      acc.push(`${prefix}${br} ${k}: ${v.toISOString()}`);
    }
    // Handle Arrays
    else if (Array.isArray(v)) {
      if (v.length === 0) {
        acc.push(`${prefix}${br} ${k}: []`);
      } else if (v.every((item) => typeof item !== "object" || item === null)) {
        // Array of primitives - show inline
        acc.push(`${prefix}${br} ${k}: [${v.join(", ")}]`);
      } else {
        // Array of objects - show each item
        acc.push(`${prefix}${br} ${k}:`);
        v.forEach((item, idx) => {
          const isLastItem = idx === v.length - 1;
          const itemBr = isLastItem ? "└─" : "├─";
          const itemNext = next + (isLastItem ? "  " : "│ ");

          if (
            typeof item === "object" &&
            item !== null &&
            !Array.isArray(item) &&
            !(item instanceof Date)
          ) {
            acc.push(`${next}${itemBr} [${idx}]:`);
            render(item as Record<string, unknown>, acc, itemNext, visited);
          } else if (item instanceof Date) {
            acc.push(`${next}${itemBr} [${idx}]: ${item.toISOString()}`);
          } else if (Array.isArray(item)) {
            acc.push(`${next}${itemBr} [${idx}]: [array]`);
          } else {
            acc.push(`${next}${itemBr} [${idx}]: ${String(item)}`);
          }
        });
      }
    }
    // Handle regular objects
    else if (typeof v === "object" && v !== null) {
      acc.push(`${prefix}${br} ${k}:`);
      render(v as Record<string, unknown>, acc, next, visited);
    }
    // Handle functions
    else if (typeof v === "function") {
      acc.push(`${prefix}${br} ${k}: [Function: ${v.name || "anonymous"}]`);
    }
    // Handle primitives
    else {
      acc.push(`${prefix}${br} ${k}: ${String(v)}`);
    }
  });

  return acc;
}

export function prettyLine(rec: LogRecord, theme?: Partial<Theme>) {
  const t = { ...themeDefaults, ...(theme || {}) } as Theme;
  const ts = fmt(new Date(rec.time));
  const c = levelColor(rec.level, t);
  const head = `${t.dim("[")}${t.bold(ts)}${t.dim("]")} ${c(rec.level.toUpperCase())}`;
  const src = [rec.service, rec.env].filter(Boolean).join(" • ");
  const srcStr = src ? ` ${t.dim("(")}${src}${t.dim(")")}` : "";
  const lines = [`${head}${srcStr} ${t.bold(rec.msg)}`];
  const meta: Record<string, unknown> = {};
  if (rec.traceId) meta.traceId = rec.traceId;
  if (rec.spanId) meta.spanId = rec.spanId;
  if (rec.version) meta.version = rec.version;
  const tree = render({ ...meta, ...(rec.context || {}) });
  if (tree.length) lines.push(...tree);
  if (rec.err) {
    const e = rec.err;
    lines.push(`└─ error: ${t.red(e.name || "Error")}: ${e.message || ""}`);
    if (e.stack)
      lines.push(
        ...String(e.stack)
          .split("\n")
          .map((l) => t.gray(`   ${l}`)),
      );
  }

  return lines.join("\n");
}

interface ECSLogFormat {
  "@timestamp": string;
  message: string;
  "log.level": string;
  "service.name"?: string;
  "event.dataset": string;
  "trace.id"?: string;
  "span.id"?: string;
  labels?: unknown;
  "error.type"?: string;
  "error.message"?: string;
  "error.stack_trace"?: string;
  "service.version"?: string;
}

export function ecsObject(rec: LogRecord) {
  const base: ECSLogFormat = {
    "@timestamp": new Date(rec.time).toISOString(),
    message: rec.msg,
    "log.level": rec.level,
    "service.name": rec.service,
    "event.dataset": rec.env
      ? `${rec.service || "app"}.${rec.env}`
      : rec.service || "app",
    "trace.id": rec.traceId,
    "span.id": rec.spanId,
    labels: rec.context,
  };
  if (rec.err) {
    base["error.type"] = rec.err.name;
    base["error.message"] = rec.err.message;
    if (rec.err.stack) base["error.stack_trace"] = rec.err.stack;
  }
  if (rec.version) base["service.version"] = rec.version;
  return base;
}

export const ecsLine = (rec: LogRecord) => JSON.stringify(ecsObject(rec));

export const datadogObject = (rec: LogRecord) => ({
  message: rec.msg,
  status: rec.level,
  level: rec.level,
  service: rec.service,
  env: rec.env,
  timestamp: rec.time,
  trace_id: rec.traceId,
  span_id: rec.spanId,
  error: rec.err || undefined,
  attributes: rec.context,
  logger: { name: "cenglu", version: rec.version },
  ddsource: "node",
});

export const datadogLine = (rec: LogRecord) =>
  JSON.stringify(datadogObject(rec));

export const splunkObject = (rec: LogRecord) => ({
  time: Math.floor(rec.time / 1000),
  sourcetype: "_json",
  source: rec.service || "app",
  event: {
    message: rec.msg,
    level: rec.level,
    service: rec.service,
    env: rec.env,
    version: rec.version,
    traceId: rec.traceId,
    spanId: rec.spanId,
    context: rec.context,
    error: rec.err || undefined,
  },
});

export const splunkLine = (rec: LogRecord) => JSON.stringify(splunkObject(rec));
