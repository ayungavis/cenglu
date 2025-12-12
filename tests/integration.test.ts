import { describe, expect, it } from "vitest";
import { LoggerContext } from "../src/context";
import { createLogger } from "../src/logger";
import { enrichPlugin, filterPlugin, samplingPlugin } from "../src/plugins";
import { createTestLogger, flushPromises } from "../src/testing";

const healthCheckRegex = /health.*check/i;

describe("Integration Tests", () => {
  describe("with plugins", () => {
    it("sampling plugin drops logs based on rate", () => {
      const base = createTestLogger();
      const { transport, random } = base;
      const logger = createLogger({
        plugins: [
          samplingPlugin({
            defaultRate: 0.5,
            random: random.bind(),
          }),
        ],
      });

      // First log: random = 0.5, rate = 0.5, 0.5 >= 0.5, dropped
      random.queue(0.5, 0.3, 0.8);

      logger.info("log 1"); // 0.5 >= 0.5, dropped
      logger.info("log 2"); // 0.3 < 0.5, kept
      logger.info("log 3"); // 0.8 >= 0.5, dropped

      expect(transport.logs).toHaveLength(1);
      expect(transport).toHaveLogged("info", "log 2");
    });

    it("filter plugin drops logs by pattern", () => {
      const { logger, transport } = createTestLogger({
        plugins: [
          filterPlugin({
            excludeMessages: [healthCheckRegex, "heartbeat"],
          }),
        ],
      });

      logger.info("health check");
      logger.info("heartbeat");
      logger.info("normal log");

      expect(transport.logs).toHaveLength(1);
      expect(transport).toHaveLogged("info", "normal log");
    });

    it("enrich plugin adds fields", () => {
      const { logger, transport } = createTestLogger({
        plugins: [
          enrichPlugin({
            fields: {
              app: "test-app",
              version: "1.0.0",
            },
          }),
        ],
      });

      logger.info("enriched log");

      const log = transport.last();
      expect(log?.context?.app).toBe("test-app");
      expect(log?.context?.version).toBe("1.0.0");
    });

    it("multiple plugins work together", () => {
      const { logger, transport } = createTestLogger({
        plugins: [
          // First: rate limit
          samplingPlugin({
            defaultRate: 1.0, // Keep all
            rates: { debug: 0 }, // Drop all debug
          }),
          // Then: enrich
          enrichPlugin({
            fields: { enriched: true },
          }),
          // Then: filter
          filterPlugin({
            excludeMessages: ["skip me"],
          }),
        ],
      });

      logger.debug("should be dropped by sampling");
      logger.info("skip me");
      logger.info("should appear");

      expect(transport.logs).toHaveLength(1);
      expect(transport.last()?.msg).toBe("should appear");
      expect(transport.last()?.context?.enriched).toBe(true);
    });
  });

  describe("with async context", () => {
    it("propagates context through async operations", async () => {
      const { logger, transport } = createTestLogger({
        useAsyncContext: true,
      });

      await LoggerContext.runAsync(
        { correlationId: "test-123", bindings: { userId: 456 } },
        async () => {
          logger.info("inside context");

          await flushPromises();

          logger.info("still inside context");
        }
      );

      expect(transport.logs).toHaveLength(2);
      expect(transport.logs[0]?.context?.userId).toBe(456);
      expect(transport.logs[1]?.context?.userId).toBe(456);
    });

    it("nested contexts work correctly", async () => {
      const { logger, transport } = createTestLogger({
        useAsyncContext: true,
      });

      await LoggerContext.runAsync({ bindings: { level: "outer" } }, async () => {
        logger.info("outer");

        // biome-ignore lint/suspicious/useAwait: testing async context
        await LoggerContext.runAsync({ bindings: { level: "inner" } }, async () => {
          logger.info("inner");
        });

        logger.info("back to outer");
      });

      expect(transport.logs[0]?.context?.level).toBe("outer");
      expect(transport.logs[1]?.context?.level).toBe("inner");
      expect(transport.logs[2]?.context?.level).toBe("outer");
    });
  });

  describe("error handling", () => {
    it("handles errors with cause chain", () => {
      const { logger, transport } = createTestLogger();

      const rootCause = new Error("Root cause");
      const middleError = new Error("Middle error");
      middleError.cause = rootCause;
      const topError = new Error("Top error");
      topError.cause = middleError;

      logger.error("Error occurred", topError);

      const log = transport.last();
      expect(log?.err?.message).toBe("Top error");
      expect(log?.err?.cause?.message).toBe("Middle error");
      expect(log?.err?.cause?.cause?.message).toBe("Root cause");
    });

    it("handles non-Error objects as errors", () => {
      const { logger, transport } = createTestLogger();

      logger.error("failed", { code: "E001", message: "Custom error" });

      const log = transport.last();
      expect(log?.err?.code).toBe("E001");
      expect(log?.err?.message).toBe("Custom error");
    });

    it("handles primitive error values", () => {
      const { logger, transport } = createTestLogger();

      logger.error("failed", "string error" as unknown as Error);

      const log = transport.last();
      expect(log?.err?.message).toBe("string error");
    });
  });
});
