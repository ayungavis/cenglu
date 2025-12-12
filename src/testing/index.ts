/**
 * Testing utilities for cenglu logger
 *
 * These utilities make it easy to test code that uses the logger
 * without actually writing to console or files.
 *
 * @example
 * import { describe, it, expect, beforeEach } from "vitest";
 * import { createTestLogger } from "cenglu/testing";
 *
 * describe("MyService", () => {
 *   let logger, transport;
 *
 *   beforeEach(() => {
 *     ({ logger, transport } = createTestLogger());
 *   });
 *
 *   it("logs user creation", async () => {
 *     const service = new MyService(logger);
 *     await service.createUser({ name: "John" });
 *
 *     expect(transport.hasLog("info", "User created")).toBe(true);
 *   });
 * });
 */

import { createLogger, type Logger } from "../logger";
import type { Bindings, ErrorInfo, LoggerOptions, LogLevel, LogRecord, Transport } from "../types";

export type CapturedLog = {
  level: LogLevel;
  msg: string;
  context?: Bindings;
  err?: ErrorInfo;
  timestamp: number;
  raw: LogRecord;
  formatted: string;
  isError: boolean;
};

/**
 * Transport that captures logs for testing
 *
 * @example
 * const transport = new TestTransport();
 * const logger = createLogger({
 *   transports: [transport],
 *   console: { enabled: false },
 * });
 *
 * logger.info("Hello", { userId: 123 });
 *
 * expect(transport.logs).toHaveLength(1);
 * expect(transport.logs[0].msg).toBe("Hello");
 * expect(transport.logs[0].context?.userId).toBe(123);
 */
export class TestTransport implements Transport {
  readonly logs: CapturedLog[] = [];
  private writeCount = 0;
  // biome-ignore lint/style/useConsistentMemberAccessibility: explicit public for clarity
  public debug = false;

  write(record: LogRecord, formatted: string, isError: boolean): void {
    this.writeCount += 1;

    const captured: CapturedLog = {
      level: record.level,
      msg: record.msg,
      context: record.context,
      err: record.err ?? undefined,
      timestamp: record.time,
      raw: record,
      formatted,
      isError,
    };

    this.logs.push(captured);

    if (this.debug) {
      console.log(`[TestTransport] ${record.level}: ${record.msg}`);
    }
  }

  clear(): void {
    this.logs.length = 0;
  }

  reset(): void {
    this.clear();
    this.writeCount = 0;
  }

  getByLevel(level: LogLevel): CapturedLog[] {
    return this.logs.filter((log) => log.level === level);
  }

  findByMessage(pattern: string | RegExp): CapturedLog[] {
    return this.logs.filter((log) => {
      if (typeof pattern === "string") {
        return log.msg.includes(pattern);
      }
      return pattern.test(log.msg);
    });
  }

  findByContext(key: string, value?: unknown): CapturedLog[] {
    return this.logs.filter((log) => {
      if (!log.context) {
        return false;
      }
      if (value === undefined) {
        return key in log.context;
      }
      return log.context[key] === value;
    });
  }

  findWithErrors(): CapturedLog[] {
    return this.logs.filter((log) => log.err !== undefined);
  }

  findByErrorName(name: string): CapturedLog[] {
    return this.logs.filter((log) => log.err?.name === name);
  }

  first(): CapturedLog | undefined {
    return this.logs[0];
  }

  last(): CapturedLog | undefined {
    // biome-ignore lint/style/useAtIndex: explicit for clarity
    return this.logs[this.logs.length - 1];
  }

  at(index: number): CapturedLog | undefined {
    return this.logs[index];
  }

  hasLog(level: LogLevel, message: string | RegExp): boolean {
    return this.logs.some((log) => {
      if (log.level !== level) {
        return false;
      }
      if (typeof message === "string") {
        return log.msg.includes(message);
      }
      return message.test(log.msg);
    });
  }

  hasMessage(message: string | RegExp): boolean {
    return this.logs.some((log) => {
      if (typeof message === "string") {
        return log.msg.includes(message);
      }
      return message.test(log.msg);
    });
  }

  hasError(errorName?: string): boolean {
    if (errorName === undefined) {
      return this.logs.some((log) => log.err !== undefined);
    }
    return this.logs.some((log) => log.err?.name === errorName);
  }

  hasContext(key: string, value?: unknown): boolean {
    return this.findByContext(key, value).length > 0;
  }

  countByLevel(level: LogLevel): number {
    return this.getByLevel(level).length;
  }

  getTotalWrites(): number {
    return this.writeCount;
  }

  assertLogged(level: LogLevel, message: string | RegExp): void {
    if (!this.hasLog(level, message)) {
      const logs = this.logs.map((l) => `  ${l.level}: ${l.msg}`).join("\n");
      throw new Error(
        // biome-ignore lint/complexity/noUselessStringConcat: improve readability
        `Expected log not found: ${level} "${message}"\n` + `Actual logs:\n${logs || "  (none)"}`
      );
    }
  }

  assertNotLogged(level: LogLevel, message: string | RegExp): void {
    if (this.hasLog(level, message)) {
      throw new Error(`Unexpected log found: ${level} "${message}"`);
    }
  }

  assertLogCount(level: LogLevel, count: number): void {
    const actual = this.countByLevel(level);
    if (actual !== count) {
      throw new Error(`Expected ${count} ${level} log(s), but found ${actual}`);
    }
  }

  assertTotalCount(count: number): void {
    if (this.logs.length !== count) {
      throw new Error(`Expected ${count} total log(s), but found ${this.logs.length}`);
    }
  }

  assertError(errorName?: string): void {
    if (!this.hasError(errorName)) {
      throw new Error(
        errorName ? `Expected error "${errorName}" not found` : "Expected an error to be logged"
      );
    }
  }

  assertNoErrors(): void {
    const errors = this.findWithErrors();
    if (errors.length > 0) {
      const errorMsgs = errors.map((e) => `  ${e.err?.name}: ${e.err?.message}`).join("\n");
      throw new Error(`Expected no errors, but found:\n${errorMsgs}`);
    }
  }

  assertContext(key: string, value?: unknown): void {
    if (!this.hasContext(key, value)) {
      throw new Error(
        value !== undefined
          ? `Expected context ${key}=${JSON.stringify(value)} not found`
          : `Expected context key "${key}" not found`
      );
    }
  }

  toSnapshot(): Array<{
    level: LogLevel;
    msg: string;
    context?: Bindings;
    error?: string;
  }> {
    return this.logs.map(({ level, msg, context, err }) => ({
      level,
      msg,
      ...(context && Object.keys(context).length > 0 ? { context } : {}),
      ...(err ? { error: `${err.name}: ${err.message}` } : {}),
    }));
  }

  toJSON(): string {
    return JSON.stringify(this.toSnapshot(), null, 2);
  }

  toFormattedStrings(): string[] {
    return this.logs.map((log) => log.formatted);
  }
}

/**
 * Mock time controller for deterministic testing
 *
 * @example
 * const time = new MockTime(1000000000000);
 * const logger = createLogger({ now: time.now.bind(time) });
 *
 * logger.info("First log");
 * time.advance(1000);
 * logger.info("Second log (1 second later)");
 */
export class MockTime {
  private currentTime: number;

  constructor(startTime = 1_700_000_000_000) {
    this.currentTime = startTime;
  }

  now(): number {
    return this.currentTime;
  }

  advance(ms: number): void {
    this.currentTime += ms;
  }

  set(time: number): void {
    this.currentTime = time;
  }

  setDate(date: Date): void {
    this.currentTime = date.getTime();
  }

  toDate(): Date {
    return new Date(this.currentTime);
  }

  bind(): () => number {
    return () => this.now();
  }

  reset(startTime = 1_700_000_000_000): void {
    this.currentTime = startTime;
  }
}

/**
 * Mock random number generator for deterministic testing
 *
 * @example
 * const random = new MockRandom([0.1, 0.5, 0.9]);
 * const logger = createLogger({
 *   random: random.bind(),
 *   sampling: { defaultRate: 0.5 },
 * });
 *
 * // First log: 0.1 < 0.5, will be logged
 * // Second log: 0.5 >= 0.5, will be dropped
 * // Third log: 0.9 >= 0.5, will be dropped
 */
export class MockRandom {
  private values: number[] = [];
  private index = 0;

  constructor(values: number[] = [0.5]) {
    this.values = values;
  }

  random(): number {
    const len = this.values.length || 1;
    const value = this.values[this.index % len] ?? 0;
    this.index += 1;
    return value;
  }

  setValues(values: number[]): void {
    this.values = values;
    this.index = 0;
  }

  next(value: number): void {
    this.values = [value];
    this.index = 0;
  }

  queue(...values: number[]): void {
    this.values = values;
    this.index = 0;
  }

  always(value: number): void {
    this.values = [value];
  }

  bind(): () => number {
    return () => this.random();
  }

  reset(): void {
    this.index = 0;
  }

  getCallCount(): number {
    return this.index;
  }
}

export type TestLoggerResult = {
  logger: Logger;
  transport: TestTransport;
  time: MockTime;
  random: MockRandom;
  reset: () => void;
};

export interface TestLoggerOptions extends Partial<LoggerOptions> {
  startTime?: number;
  randomValues?: number[];
  debug?: boolean;
}

/**
 * Create a logger configured for testing
 *
 * This creates a logger with:
 * - A TestTransport for capturing logs
 * - MockTime for controlling time
 * - MockRandom for controlling sampling
 * - Console and file transports disabled
 * - Trace level enabled (capture all logs)
 *
 * @example
 * import { describe, it, expect, beforeEach } from "vitest";
 * import { createTestLogger } from "cenglu/testing";
 *
 * describe("UserService", () => {
 *   let logger: Logger;
 *   let transport: TestTransport;
 *
 *   beforeEach(() => {
 *     ({ logger, transport } = createTestLogger());
 *   });
 *
 *   it("logs user creation", async () => {
 *     const service = new UserService(logger);
 *     await service.createUser({ email: "test@example.com" });
 *
 *     expect(transport.hasLog("info", "User created")).toBe(true);
 *     expect(transport.last()?.context?.email).toBe("test@example.com");
 *   });
 *
 *   it("logs errors correctly", async () => {
 *     const service = new UserService(logger);
 *
 *     await expect(service.createUser({ email: "" }))
 *       .rejects.toThrow("Invalid email");
 *
 *     expect(transport.hasError("ValidationError")).toBe(true);
 *   });
 * });
 */
export function createTestLogger(options: TestLoggerOptions = {}): TestLoggerResult {
  const {
    startTime = 1_700_000_000_000,
    randomValues = [0.5],
    debug = false,
    ...loggerOptions
  } = options;

  const transport = new TestTransport();
  transport.debug = debug;

  // Make the test transport discoverable globally during tests so that
  // subsequent createLogger() calls without explicit transports will include it.
  // biome-ignore lint/suspicious/noExplicitAny: needed for global
  (globalThis as any).__CENG_LU_TEST_TRANSPORT__ = transport;

  const time = new MockTime(startTime);
  const random = new MockRandom(randomValues);

  const logger = createLogger({
    level: "trace", // Capture all levels by default
    console: { enabled: false },
    file: { enabled: false },
    useAsyncContext: false, // Disable async context for simpler testing
    ...loggerOptions,
    transports: [transport, ...(loggerOptions.transports ?? [])],
    now: time.bind(),
    random: random.bind(),
  });

  const reset = () => {
    transport.reset();
    time.reset(startTime);
    random.reset();
    // Remove the global test transport if it's still pointing to this one.
    // biome-ignore lint/suspicious/noExplicitAny: needed for global
    if ((globalThis as any).__CENG_LU_TEST_TRANSPORT__ === transport) {
      // biome-ignore lint/suspicious/noExplicitAny: needed for global
      // biome-ignore lint/performance/noDelete: cleanup
      delete (globalThis as any).__CENG_LU_TEST_TRANSPORT__;
    }
  };

  return { logger, transport, time, random, reset };
}

export function flushPromises(): Promise<void> {
  return new Promise((resolve) => setImmediate(resolve));
}

export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

/**
 * Create a mock error with controlled properties
 *
 * @example
 * const error = createMockError("ValidationError", "Email is required", {
 *   code: "E001",
 * });
 */
export function createMockError(
  name: string,
  message: string,
  options?: {
    code?: string | number;
    cause?: Error;
    stack?: string;
    [key: string]: unknown;
  }
): Error {
  const error = new Error(message);
  error.name = name;

  if (options?.code !== undefined) {
    (error as Error & { code: string | number }).code = options.code;
  }

  if (options?.cause !== undefined) {
    error.cause = options.cause;
  }

  if (options?.stack !== undefined) {
    error.stack = options.stack;
  } else {
    // Create a clean, deterministic stack for testing
    error.stack = `${name}: ${message}\n    at test.ts:1:1\n    at testRunner.ts:1:1`;
  }

  // Add any additional properties
  if (options) {
    for (const [key, value] of Object.entries(options)) {
      if (key !== "code" && key !== "cause" && key !== "stack") {
        (error as unknown as Record<string, unknown>)[key] = value;
      }
    }
  }

  return error;
}

export function createMockContext(overrides: Bindings = {}): Bindings {
  return {
    requestId: "test-request-123",
    userId: "test-user-456",
    ...overrides,
  };
}

/**
 * Assert that a function logs a specific message
 *
 * @example
 * await assertLogs(
 *   () => myFunction(),
 *   "info",
 *   "Function completed",
 *   logger,
 *   transport
 * );
 */
export async function assertLogs(
  fn: () => unknown | Promise<unknown>,
  level: LogLevel,
  message: string | RegExp,
  _logger: Logger,
  transport: TestTransport
): Promise<void> {
  const countBefore = transport.logs.length;

  await fn();

  const newLogs = transport.logs.slice(countBefore);
  const found = newLogs.some((log) => {
    if (log.level !== level) {
      return false;
    }
    if (typeof message === "string") {
      return log.msg.includes(message);
    }
    return message.test(log.msg);
  });

  if (!found) {
    const logMsgs = newLogs.map((l) => `  ${l.level}: ${l.msg}`).join("\n");
    throw new Error(
      `Expected "${level}: ${message}" to be logged.\n` +
        `Logs during execution:\n${logMsgs || "  (none)"}`
    );
  }
}

export async function assertNoLogs(
  fn: () => unknown | Promise<unknown>,
  level: LogLevel,
  message: string | RegExp,
  _logger: Logger,
  transport: TestTransport
): Promise<void> {
  const countBefore = transport.logs.length;

  await fn();

  const newLogs = transport.logs.slice(countBefore);
  const found = newLogs.some((log) => {
    if (log.level !== level) {
      return false;
    }
    if (typeof message === "string") {
      return log.msg.includes(message);
    }
    return message.test(log.msg);
  });

  if (found) {
    throw new Error(`Expected "${level}: ${message}" NOT to be logged.`);
  }
}

/**
 * A transport that calls a spy function for each log
 *
 * @example
 * const spy = vi.fn();
 * const transport = new SpyTransport(spy);
 *
 * logger.info("Hello");
 *
 * expect(spy).toHaveBeenCalledWith(
 *   expect.objectContaining({ level: "info", msg: "Hello" }),
 *   expect.any(String),
 *   false
 * );
 */
export class SpyTransport implements Transport {
  constructor(
    // biome-ignore lint/style/noParameterProperties: explicit for clarity
    private readonly spy: (record: LogRecord, formatted: string, isError: boolean) => void
  ) {}

  write(record: LogRecord, formatted: string, isError: boolean): void {
    this.spy(record, formatted, isError);
  }
}

export function createSpyTransport(
  spy: (record: LogRecord, formatted: string, isError: boolean) => void
): SpyTransport {
  return new SpyTransport(spy);
}

export class NullTransport implements Transport {
  write(): void {
    // Discard
  }
}

export function createNullTransport(): NullTransport {
  return new NullTransport();
}

export function createNullLogger(options: Partial<LoggerOptions> = {}): Logger {
  return createLogger({
    console: { enabled: false },
    file: { enabled: false },
    transports: [new NullTransport()],
    ...options,
  });
}

// biome-ignore lint/performance/noBarrelFile: centralized exports
export {
  assert,
  loggerMatchers,
  setupLoggerMatchers,
} from "./matchers";
