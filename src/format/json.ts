import type { LogRecord } from "../types";

/**
 * Custom JSON replacer to handle special types
 */
export function jsonReplacer(_key: string, value: unknown): unknown {
  // Handle BigInt
  if (typeof value === "bigint") {
    return value.toString();
  }

  // Handle Buffer
  if (Buffer.isBuffer(value)) {
    return `[Buffer: ${value.length} bytes]`;
  }

  // Handle undefined in arrays
  if (value === undefined) {
    return null;
  }

  // Handle Error objects (in case they slip through)
  if (value instanceof Error) {
    return {
      name: value.name,
      message: value.message,
      stack: value.stack,
    };
  }

  // Handle circular references (shouldn't happen with WeakSet, but safety net)
  if (typeof value === "object" && value !== null) {
    try {
      // This will throw if there's a circular reference
      JSON.stringify(value);
    } catch {
      return "[Circular]";
    }
  }

  return value;
}

/**
 * Format a log record as JSON
 */
export function formatJson(record: LogRecord): string {
  return JSON.stringify(record, jsonReplacer);
}

/**
 * Format a log record as JSON with custom transform
 */
export function formatJsonWithTransform(
  record: LogRecord,
  // biome-ignore lint/nursery/noShadow: intentional
  transform: (record: LogRecord) => unknown
): string {
  return JSON.stringify(transform(record), jsonReplacer);
}
