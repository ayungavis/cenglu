import type { LogLevel } from "../types";
import type { CapturedLog, TestTransport } from "./index";

type MatcherResult = {
  pass: boolean;
  message: () => string;
};

function formatLogs(logs: CapturedLog[]): string {
  if (logs.length === 0) {
    return "  (none)";
  }
  return logs.map((l) => `  ${l.level}: ${l.msg}`).join("\n");
}

export const loggerMatchers = {
  toHaveLogged(transport: TestTransport, level: LogLevel, message: string | RegExp): MatcherResult {
    const found = transport.hasLog(level, message);

    return {
      pass: found,
      message: () =>
        found
          ? `Expected logger NOT to have logged ${level}: "${message}"`
          : `Expected logger to have logged ${level}: "${message}"\n` +
            `Actual logs:\n${formatLogs(transport.logs)}`,
    };
  },

  toHaveLogCount(transport: TestTransport, level: LogLevel, count: number): MatcherResult {
    const actual = transport.countByLevel(level);

    return {
      pass: actual === count,
      message: () => `Expected ${count} ${level} log(s), but found ${actual}`,
    };
  },

  toHaveLoggedError(transport: TestTransport, errorName?: string): MatcherResult {
    const found = transport.hasError(errorName);

    return {
      pass: found,
      message: () =>
        found
          ? `Expected logger NOT to have logged error${errorName ? `: ${errorName}` : ""}`
          : `Expected logger to have logged error${errorName ? `: ${errorName}` : ""}\n` +
            `Actual errors:\n${formatLogs(transport.findWithErrors())}`,
    };
  },

  toHaveLoggedWithContext(transport: TestTransport, key: string, value?: unknown): MatcherResult {
    const found = transport.hasContext(key, value);

    return {
      pass: found,
      message: () =>
        found
          ? `Expected logger NOT to have logged with context ${key}${value !== undefined ? `=${JSON.stringify(value)}` : ""}`
          : `Expected logger to have logged with context ${key}${value !== undefined ? `=${JSON.stringify(value)}` : ""}`,
    };
  },

  toHaveNoLogs(transport: TestTransport, level?: LogLevel): MatcherResult {
    const logs = level ? transport.getByLevel(level) : transport.logs;
    const pass = logs.length === 0;

    return {
      pass,
      message: () =>
        pass
          ? `Expected some ${level ?? ""} logs to exist`
          : `Expected no ${level ?? ""} logs, but found:\n${formatLogs(logs)}`,
    };
  },

  toHaveLastLog(
    transport: TestTransport,
    level: LogLevel,
    message: string | RegExp
  ): MatcherResult {
    const last = transport.last();

    if (!last) {
      return {
        pass: false,
        message: () => "Expected a log to exist, but none were found",
      };
    }

    const levelMatch = last.level === level;
    const messageMatch =
      typeof message === "string" ? last.msg.includes(message) : message.test(last.msg);

    const pass = levelMatch && messageMatch;

    return {
      pass,
      message: () =>
        pass
          ? `Expected last log NOT to be ${level}: "${message}"`
          : `Expected last log to be ${level}: "${message}"\n` +
            `Actual last log: ${last.level}: ${last.msg}`,
    };
  },
};

/**
 * Setup function to extend expect with logger matchers
 *
 * @example
 * // In your test setup file (e.g., vitest.setup.ts)
 * import { expect } from "vitest";
 * import { setupLoggerMatchers } from "cenglu/testing";
 *
 * setupLoggerMatchers(expect);
 *
 * // Or in a test file:
 * beforeAll(() => {
 *   setupLoggerMatchers(expect);
 * });
 */
export function setupLoggerMatchers(expect: {
  // biome-ignore lint/suspicious/noExplicitAny: needed for matcher args
  extend: (matchers: Record<string, (...args: any[]) => MatcherResult>) => void;
}): void {
  expect.extend({
    toHaveLogged(received: TestTransport, level: LogLevel, message: string | RegExp) {
      return loggerMatchers.toHaveLogged(received, level, message);
    },

    toHaveLogCount(received: TestTransport, level: LogLevel, count: number) {
      return loggerMatchers.toHaveLogCount(received, level, count);
    },

    toHaveLoggedError(received: TestTransport, errorName?: string) {
      return loggerMatchers.toHaveLoggedError(received, errorName);
    },

    toHaveLoggedWithContext(received: TestTransport, key: string, value?: unknown) {
      return loggerMatchers.toHaveLoggedWithContext(received, key, value);
    },

    toHaveNoLogs(received: TestTransport, level?: LogLevel) {
      return loggerMatchers.toHaveNoLogs(received, level);
    },

    toHaveLastLog(received: TestTransport, level: LogLevel, message: string | RegExp) {
      return loggerMatchers.toHaveLastLog(received, level, message);
    },
  });
}

/**
 * Assert helpers that throw on failure
 *
 * For use in testing environments without custom matchers
 *
 * @example
 * import { assert } from "cenglu/testing";
 *
 * assert.logged(transport, "info", "User created");
 * assert.noErrors(transport);
 */
export const assert = {
  logged(transport: TestTransport, level: LogLevel, message: string | RegExp): void {
    transport.assertLogged(level, message);
  },

  notLogged(transport: TestTransport, level: LogLevel, message: string | RegExp): void {
    transport.assertNotLogged(level, message);
  },

  logCount(transport: TestTransport, level: LogLevel, count: number): void {
    transport.assertLogCount(level, count);
  },

  totalCount(transport: TestTransport, count: number): void {
    transport.assertTotalCount(count);
  },

  error(transport: TestTransport, errorName?: string): void {
    transport.assertError(errorName);
  },

  noErrors(transport: TestTransport): void {
    transport.assertNoErrors();
  },

  context(transport: TestTransport, key: string, value?: unknown): void {
    transport.assertContext(key, value);
  },
};

export type { MatcherResult };
