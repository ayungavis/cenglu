import { beforeEach, describe, expect, it } from "vitest";
import type { Logger } from "../src/logger";
import type { MockTime, TestTransport } from "../src/testing";
import { createMockError, createTestLogger } from "../src/testing";

const testRegex = /test/;

describe("Logger", () => {
  let logger: Logger;
  let transport: TestTransport;
  let time: MockTime;

  beforeEach(() => {
    ({ logger, transport } = createTestLogger());
  });

  describe("basic logging", () => {
    it("logs at different levels", () => {
      logger.trace("trace message");
      logger.debug("debug message");
      logger.info("info message");
      logger.warn("warn message");
      logger.error("error message");
      logger.fatal("fatal message");

      expect(transport.logs).toHaveLength(6);
      expect(transport.getByLevel("trace")).toHaveLength(1);
      expect(transport.getByLevel("debug")).toHaveLength(1);
      expect(transport.getByLevel("info")).toHaveLength(1);
      expect(transport.getByLevel("warn")).toHaveLength(1);
      expect(transport.getByLevel("error")).toHaveLength(1);
      expect(transport.getByLevel("fatal")).toHaveLength(1);
    });

    it("logs with context", () => {
      logger.info("user action", { userId: 123, action: "login" });

      const log = transport.last();
      expect(log?.msg).toBe("user action");
      expect(log?.context?.userId).toBe(123);
      expect(log?.context?.action).toBe("login");
    });

    it("logs with error", () => {
      const error = createMockError("TestError", "Something went wrong");
      logger.error("operation failed", error);

      const log = transport.last();
      expect(log?.msg).toBe("operation failed");
      expect(log?.err?.name).toBe("TestError");
      expect(log?.err?.message).toBe("Something went wrong");
    });

    it("logs with error and context", () => {
      const error = createMockError("TestError", "Something went wrong");
      logger.error("operation failed", error, { operationId: "abc" });

      const log = transport.last();
      expect(log?.msg).toBe("operation failed");
      expect(log?.err?.name).toBe("TestError");
      expect(log?.context?.operationId).toBe("abc");
    });
  });

  describe("level filtering", () => {
    it("respects minimum log level", () => {
      logger.setLevel("warn");

      logger.debug("should not appear");
      logger.info("should not appear");
      logger.warn("should appear");
      logger.error("should appear");

      expect(transport.logs).toHaveLength(2);
      expect(transport).toHaveLogged("warn", "should appear");
      expect(transport).toHaveLogged("error", "should appear");
    });

    it("isLevelEnabled returns correct value", () => {
      logger.setLevel("info");

      expect(logger.isLevelEnabled("trace")).toBe(false);
      expect(logger.isLevelEnabled("debug")).toBe(false);
      expect(logger.isLevelEnabled("info")).toBe(true);
      expect(logger.isLevelEnabled("warn")).toBe(true);
      expect(logger.isLevelEnabled("error")).toBe(true);
    });
  });

  describe("child loggers", () => {
    it("creates child logger with additional bindings", () => {
      const child = logger.child({ requestId: "abc-123" });
      child.info("child log");

      const log = transport.last();
      expect(log?.context?.requestId).toBe("abc-123");
    });

    it("child inherits parent bindings", () => {
      const parent = logger.child({ service: "api" });
      const child = parent.child({ requestId: "abc-123" });
      child.info("nested child log");

      const log = transport.last();
      expect(log?.context?.service).toBe("api");
      expect(log?.context?.requestId).toBe("abc-123");
    });

    it("child can override parent bindings", () => {
      const parent = logger.child({ env: "production" });
      const child = parent.child({ env: "test" });
      child.info("overridden binding");

      const log = transport.last();
      expect(log?.context?.env).toBe("test");
    });
  });

  describe("bound logger", () => {
    it("creates bound logger with context", () => {
      const bound = logger.with({ userId: 456 });
      bound.info("bound log");

      const log = transport.last();
      expect(log?.context?.userId).toBe(456);
    });

    it("bound logger merges context", () => {
      const bound = logger.with({ userId: 456 });
      bound.info("with extra context", { action: "click" });

      const log = transport.last();
      expect(log?.context?.userId).toBe(456);
      expect(log?.context?.action).toBe("click");
    });
  });

  describe("timer", () => {
    it("logs duration", () => {
      ({ logger, transport, time } = createTestLogger());

      const done = logger.time("operation");
      time.advance(100);
      done();

      const log = transport.last();
      expect(log?.msg).toBe("operation completed");
      expect(log?.context?.durationMs).toBe(100);
    });

    it("timer includes custom context", () => {
      ({ logger, transport, time } = createTestLogger());

      const done = logger.time("query", { table: "users" });
      time.advance(50);
      done();

      const log = transport.last();
      expect(log?.context?.table).toBe("users");
      expect(log?.context?.durationMs).toBe(50);
    });
  });

  describe("conditional logging", () => {
    it("ifDebug only calls function if debug is enabled", () => {
      let called = false;

      logger.setLevel("info");
      logger.ifDebug(() => {
        called = true;
        return ["debug message", { computed: true }];
      });

      expect(called).toBe(false);
      expect(transport.logs).toHaveLength(0);
    });

    it("ifDebug calls function when debug is enabled", () => {
      let called = false;

      logger.setLevel("debug");
      logger.ifDebug(() => {
        called = true;
        return ["debug message", { computed: true }];
      });

      expect(called).toBe(true);
      expect(transport).toHaveLogged("debug", "debug message");
    });
  });

  describe("custom matchers", () => {
    it("toHaveLogged matcher works", () => {
      logger.info("test message");

      expect(transport).toHaveLogged("info", "test message");
      expect(transport).toHaveLogged("info", testRegex);
    });

    it("toHaveLogCount matcher works", () => {
      logger.info("one");
      logger.info("two");
      logger.error("error");

      expect(transport).toHaveLogCount("info", 2);
      expect(transport).toHaveLogCount("error", 1);
    });

    it("toHaveLoggedError matcher works", () => {
      logger.error("failed", createMockError("ValidationError", "Invalid input"));

      expect(transport).toHaveLoggedError("ValidationError");
      expect(transport).toHaveLoggedError();
    });
  });
});
