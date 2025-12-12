import { DEFAULT_THEME, DEFAULT_TREE_OPTIONS, LEVEL_COLORS } from "../constants";
import type { ErrorInfo, LogRecord, Theme, TreeOptions } from "../types";
import { formatTimestamp } from "./datetime";

/**
 * Render an object as a tree structure
 */
export function renderTree(
  obj: Record<string, unknown>,
  options: TreeOptions = {},
  prefix = "",
  visited: WeakSet<object> = new WeakSet<object>(),
  depth = 0
): string[] {
  const opts = { ...DEFAULT_TREE_OPTIONS, ...options };

  if (depth > opts.maxDepth) {
    return [`${prefix}└─ [Max depth exceeded]`];
  }

  if (obj === null || obj === undefined) {
    return [];
  }

  if (typeof obj !== "object") {
    return [`${prefix}└─ ${String(obj)}`];
  }

  if (visited.has(obj)) {
    return [`${prefix}└─ [Circular]`];
  }
  visited.add(obj);

  const entries = Object.entries(obj);
  const lines: string[] = [];

  entries.forEach(([key, value]: [string, unknown], index: number) => {
    const isLast = index === entries.length - 1;
    const branch = isLast ? "└─" : "├─";
    const nextPrefix = prefix + (isLast ? "   " : "│  ");

    const formattedValue = formatValue(value, key, nextPrefix, visited, depth + 1, opts);

    if (typeof formattedValue === "string") {
      lines.push(`${prefix}${branch} ${key}: ${formattedValue}`);
    } else {
      lines.push(`${prefix}${branch} ${key}:`);
      lines.push(...formattedValue);
    }
  });

  return lines;
}

/**
 * Format a single value for tree rendering
 */
export function formatValue(
  value: unknown,
  _key: string,
  prefix: string,
  visited: WeakSet<object>,
  depth: number,
  opts: Required<TreeOptions>
): string | string[] {
  if (value === null) {
    return "null";
  }
  if (value === undefined) {
    return "undefined";
  }

  // Primitives
  if (typeof value === "string") {
    if (value.length > opts.maxStringLength) {
      return `"${value.slice(0, opts.maxStringLength)}..." (${value.length} chars)`;
    }
    return `"${value}"`;
  }

  if (typeof value === "number") {
    return String(value);
  }
  if (typeof value === "boolean") {
    return String(value);
  }
  if (typeof value === "bigint") {
    return `${value}n`;
  }
  if (typeof value === "symbol") {
    return value.toString();
  }
  if (typeof value === "function") {
    return `[Function: ${value.name || "anonymous"}]`;
  }

  // Date
  if (value instanceof Date) {
    return value.toISOString();
  }

  // Buffer
  if (Buffer.isBuffer(value)) {
    return `[Buffer: ${value.length} bytes]`;
  }

  // Error
  if (value instanceof Error) {
    return `[${value.name}: ${value.message}]`;
  }

  // Array
  if (Array.isArray(value)) {
    return formatArray(value, prefix, visited, depth, opts);
  }

  // Regular object
  if (typeof value === "object") {
    if (visited.has(value)) {
      return "[Circular]";
    }
    return renderTree(value as Record<string, unknown>, opts, prefix, visited, depth);
  }

  return String(value);
}

/**
 * Format an array for tree rendering
 */
export function formatArray(
  arr: unknown[],
  prefix: string,
  visited: WeakSet<object>,
  depth: number,
  opts: Required<TreeOptions>
): string | string[] {
  if (arr.length === 0) {
    return "[]";
  }

  // Check if array contains only primitives
  const allPrimitives = arr.every(
    (item: unknown) => item === null || (typeof item !== "object" && typeof item !== "function")
  );

  // Short primitive arrays can be inline
  if (allPrimitives && arr.length <= 5) {
    const items = arr.map((item: unknown) =>
      typeof item === "string" ? `"${item}"` : String(item)
    );
    const inline = `[${items.join(", ")}]`;
    if (inline.length <= 80) {
      return inline;
    }
  }

  // Truncate long arrays
  const displayItems = arr.length > opts.maxArrayLength ? arr.slice(0, opts.maxArrayLength) : arr;

  const lines: string[] = [];

  displayItems.forEach((item: unknown, index: number) => {
    const isLast = index === displayItems.length - 1 && arr.length <= opts.maxArrayLength;
    const branch = isLast ? "└─" : "├─";
    const nextPrefix = prefix + (isLast ? "   " : "│  ");

    const formattedItem = formatValue(item, String(index), nextPrefix, visited, depth + 1, opts);

    if (typeof formattedItem === "string") {
      lines.push(`${prefix}${branch} [${index}]: ${formattedItem}`);
    } else {
      lines.push(`${prefix}${branch} [${index}]:`);
      lines.push(...formattedItem);
    }
  });

  if (arr.length > opts.maxArrayLength) {
    lines.push(`${prefix}└─ ... ${arr.length - opts.maxArrayLength} more items`);
  }

  return lines;
}

/**
 * Format a log record for human-readable console output
 */
export function formatPretty(
  record: LogRecord,
  themeOverrides?: Partial<Theme>,
  options?: TreeOptions
): string {
  // Merge theme
  const theme: Theme = themeOverrides ? { ...DEFAULT_THEME, ...themeOverrides } : DEFAULT_THEME;

  // Format timestamp
  const timestamp = formatTimestamp(record.time);

  // Format level with color
  const levelColorFn = theme[LEVEL_COLORS[record.level] || "gray"];
  const levelStr = levelColorFn(record.level.toUpperCase().padEnd(5));

  // Build header line
  const header = `${theme.dim("[")}${theme.bold(timestamp)}${theme.dim("]")} ${levelStr}`;

  // Add service/env info
  const source = [record.service, record.env].filter(Boolean).join(" • ");
  const sourceStr = source ? ` ${theme.dim("(")}${source}${theme.dim(")")}` : "";

  // Start with message line
  const lines: string[] = [`${header}${sourceStr} ${theme.bold(record.msg)}`];

  // Build metadata object for tree rendering
  const meta: Record<string, unknown> = {};
  if (record.traceId) {
    meta.traceId = record.traceId;
  }
  if (record.spanId) {
    meta.spanId = record.spanId;
  }
  if (record.version) {
    meta.version = record.version;
  }

  // Merge with context
  const combinedMeta = { ...meta, ...(record.context || {}) };

  // Render metadata tree
  if (Object.keys(combinedMeta).length > 0) {
    const treeLines = renderTree(combinedMeta, options);
    lines.push(...treeLines);
  }

  // Render error if present
  if (record.err) {
    lines.push(...formatErrorPretty(record.err, theme));
  }

  return lines.join("\n");
}

/**
 * Format an error for pretty output
 */
export function formatErrorPretty(err: ErrorInfo, theme: Theme): string[] {
  const lines: string[] = [];

  const name = err.name || "Error";
  const message = err.message || "";

  lines.push(`└─ ${theme.red("error")}: ${theme.bold(name)}: ${message}`);

  // Add error code if present
  if (err.code !== undefined) {
    lines.push(`   ${theme.dim("code:")} ${err.code}`);
  }

  // Add stack trace
  if (err.stack) {
    const stackLines = err.stack
      .split("\n")
      .slice(1) // Skip the first line (error message)
      .map((line: string) => line.trim())
      .filter((line: string) => line.length > 0);

    for (const line of stackLines) {
      lines.push(`   ${theme.gray(line)}`);
    }
  }

  // Add cause if present
  if (err.cause) {
    lines.push(`   ${theme.dim("caused by:")}`);
    const causeLines = formatErrorPretty(err.cause, theme);
    lines.push(...causeLines.map((line: string) => `   ${line}`));
  }

  return lines;
}
