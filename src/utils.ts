import { LEVEL_VALUES } from "./constants";
import type { ErrorInfo, LogLevel } from "./types";

export function isValidLevel(level: unknown): level is LogLevel {
  return typeof level === "string" && level in LEVEL_VALUES;
}

export function compareLevels(a: LogLevel, b: LogLevel): number {
  return LEVEL_VALUES[a] - LEVEL_VALUES[b];
}

export function isError(value: unknown): value is Error {
  return value instanceof Error;
}

export function isPlainObject(value: unknown): value is Record<string, unknown> {
  if (value === null || typeof value !== "object") {
    return false;
  }
  const proto = Object.getPrototypeOf(value);
  return proto === null || proto === Object.prototype;
}

export function hasKeys(obj: object): boolean {
  for (const _ in obj) {
    if (_) {
      return true;
    }
  }
  return false;
}

export function getEnvLevel(): LogLevel | undefined {
  const env = process.env.LOG_LEVEL;
  return isValidLevel(env) ? env : undefined;
}

export function getDefaultLevel(): LogLevel {
  return getEnvLevel() ?? (process.env.NODE_ENV === "production" ? "info" : "debug");
}

export function extractError(err: unknown, seen = new WeakSet<object>()): ErrorInfo {
  // Handle Error instances
  if (isError(err)) {
    // Prevent circular reference in error cause chain
    if (seen.has(err)) {
      return { name: "Error", message: "[Circular]" };
    }
    seen.add(err);

    const info: ErrorInfo = {
      name: err.name,
      message: err.message,
      stack: err.stack,
    };

    // Extract additional enumerable properties
    const descriptor = Object.getOwnPropertyDescriptors(err);
    for (const [key, desc] of Object.entries(descriptor)) {
      if (key !== "name" && key !== "message" && key !== "stack" && desc.enumerable) {
        info[key] = (err as unknown as Record<string, unknown>)[key];
      }
    }

    // Handle error code (common in Node.js errors)
    if ("code" in err && err.code !== undefined) {
      info.code = err.code as string | number;
    }

    // Handle cause (ES2022+)
    if ("cause" in err && err.cause !== undefined) {
      info.cause = extractError(err.cause, seen);
    }

    return info;
  }

  // Handle plain objects that look like errors
  if (isPlainObject(err)) {
    return {
      name: String(err.name ?? "Error"),
      message: String(err.message ?? "Unknown error"),
      stack: typeof err.stack === "string" ? err.stack : undefined,
      ...err,
    };
  }

  // Handle primitives
  return { name: "Error", message: String(err) };
}
