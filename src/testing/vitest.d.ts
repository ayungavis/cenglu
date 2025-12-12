import type { LogLevel } from "../types";

/**
 * Custom matchers for Vitest/Jest
 *
 * These matchers make it easier to write assertions about logs.
 *
 * @example
 * import { expect } from "vitest";
 * import { setupLoggerMatchers } from "cenglu/testing";
 *
 * setupLoggerMatchers(expect);
 *
 * // Now you can use custom matchers:
 * expect(transport).toHaveLogged("info", "User created");
 * expect(transport).toHaveLogCount("error", 0);
 * expect(transport).toHaveLoggedError("ValidationError");
 */

type CustomLoggerMatchers<R = unknown> = {
  toHaveLogged(level: LogLevel, message: string | RegExp): R;
  toHaveLogCount(level: LogLevel, count: number): R;
  toHaveLoggedError(errorName?: string): R;
  toHaveLoggedWithContext(key: string, value?: unknown): R;
  toHaveNoLogs(level?: LogLevel): R;
  toHaveLastLog(level: LogLevel, message: string | RegExp): R;
};

// Extend Vitest's types
declare module "vitest" {
  interface Assertion<T = unknown> extends CustomLoggerMatchers<T> {}
  interface Matchers<R = unknown, T = unknown> extends CustomLoggerMatchers<R> {}
  interface AsymmetricMatchersContaining extends CustomLoggerMatchers {}
}

// Extend global `expect` types for Expect compatibility
declare module "expect" {
  interface Matchers<R = unknown, T = unknown> extends CustomLoggerMatchers<R> {}
}

// Extend global `expect` types for Jest compatibility
declare global {
  // biome-ignore lint/style/noNamespace: preferModule
  namespace jest {
    interface Matchers<R> extends CustomLoggerMatchers<R> {}
  }
}

export type { CustomLoggerMatchers };
