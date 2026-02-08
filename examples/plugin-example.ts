/**
 * Example: plugin-example.ts
 *
 * Demonstrates using the built-in batching plugin (HTTP sink) to send
 * logs in batches to a remote HTTP endpoint. This example includes:
 *
 * - A tiny local HTTP server that receives batches for demonstration.
 * - A logger configured with `httpBatchingPlugin`.
 * - An `enrichPlugin` to add process/host metadata to each record.
 * - Proper shutdown handling that flushes and closes plugins/transports.
 *
 * Run with:
 *   npx ts-node logger/examples/plugin-example.ts
 *
 * Notes:
 * - This example targets Node.js (v18+ recommended because the plugin uses `fetch`).
 * - Replace the local server URL with a production endpoint when integrating.
 */

import { createLogger, enrichPlugin, httpBatchingPlugin, type LogRecord } from "cenglu";
import http from "http";
import { setTimeout as delay } from "timers/promises";

const LOCAL_RECEIVER_PORT = 4000;
const LOCAL_RECEIVER_URL = `http://localhost:${LOCAL_RECEIVER_PORT}/logs`;

/**
 * Start a tiny HTTP server that accepts POST batches and prints them.
 * This is purely for the example so you can see what the batching plugin sends.
 */
function startLocalReceiver() {
  const server = http.createServer(async (req, res) => {
    if (req.method !== "POST" || req.url !== "/logs") {
      res.statusCode = 404;
      res.end("not found");
      return;
    }

    try {
      const chunks: Buffer[] = [];
      for await (const chunk of req) {
        chunks.push(chunk as Buffer);
      }
      const body = Buffer.concat(chunks).toString("utf-8");

      // Print the incoming batch (likely JSON)
      // In production you'd parse/validate/send to an ingestion backend.
      console.log("\n[Receiver] Received batch:");
      try {
        const parsed = JSON.parse(body);
        console.log(JSON.stringify(parsed, null, 2));
      } catch {
        console.log(body);
      }

      res.statusCode = 200;
      res.end("ok");
    } catch (err) {
      console.error("[Receiver] Error handling request:", err);
      res.statusCode = 500;
      res.end("error");
    }
  });

  server.listen(LOCAL_RECEIVER_PORT, () => {
    console.log(`[Receiver] Listening on http://localhost:${LOCAL_RECEIVER_PORT}/logs`);
  });

  return server;
}

/**
 * Create a logger that batches logs into HTTP requests.
 *
 * Key options:
 * - `maxBatchSize`: send after this many records
 * - `maxWaitMs`: flush after this many milliseconds if the batch didn't fill
 * - `transform`: optional mapping of records before sending (keeps payload small)
 */
function createBatchedLogger() {
  const logger = createLogger({
    service: "plugin-example",
    level: "debug",
    // Add small enrich plugin to attach process info and hostname
    plugins: [
      enrichPlugin({
        addProcessInfo: true,
        addHostname: true,
      }),
      httpBatchingPlugin({
        url: LOCAL_RECEIVER_URL,
        method: "POST",
        headers: {
          "Content-Type": "application/json",
          "X-Example": "plugin-example",
        },
        maxBatchSize: 5, // send when 5 records accumulated
        maxWaitMs: 2000, // or send after 2s
        transform: (records: LogRecord[]) =>
          // Keep the outgoing payload compact: only the fields we need
          records.map((r) => ({
            time: r.time,
            level: r.level,
            msg: r.msg,
            context: r.context ?? {},
            // include trace/span ids if present
            traceId: r.traceId,
            spanId: r.spanId,
            err: r.err ?? undefined,
          })),
      }),
    ],
  });

  return logger;
}

/**
 * Simulate application behavior that generates logs.
 * We produce a mix of info/debug/error-level logs to exercise batching.
 */
async function generateLogs(logger: ReturnType<typeof createBatchedLogger>) {
  for (let i = 1; i <= 20; i++) {
    logger.info("processing.item.start", { item: i });
    // Simulate occasional error
    if (i % 7 === 0) {
      logger.error("processing.item.error", new Error(`failed to handle ${i}`));
    } else {
      logger.debug("processing.item.progress", { step: i % 3 });
    }

    // small delay between logs so batching has a chance to group them
    await delay(250);
  }
}

/**
 * Main: run the receiver, create logger, generate logs, and gracefully shutdown.
 */
async function main() {
  const receiver = startLocalReceiver();
  const logger = createBatchedLogger();

  // Graceful shutdown handler
  let shuttingDown = false;
  async function shutdown(signal?: string) {
    if (shuttingDown) {
      return;
    }
    shuttingDown = true;
    console.log(`\n[Main] Shutting down${signal ? `(${signal})` : ""}...`);

    try {
      console.log("[Main] Flushing logger...");
      await logger.flush();
      console.log("[Main] Closing logger...");
      await logger.close();
      console.log("[Main] Closing receiver...");
      await new Promise<void>((resolve, reject) =>
        receiver.close((err) => (err ? reject(err) : resolve()))
      );
      console.log("[Main] Shutdown complete.");
    } catch (err) {
      console.error("[Main] Error during shutdown:", err);
    } finally {
      // Exit process (useful when running as a script)
      // Note: avoid forcing exit in library code.
      process.exit(0);
    }
  }

  process.on("SIGINT", () => shutdown("SIGINT"));
  process.on("SIGTERM", () => shutdown("SIGTERM"));

  // Generate logs and then shutdown automatically for demo
  try {
    await generateLogs(logger);
    // Wait a little longer to let the batching plugin flush via timer
    await delay(3000);
    await shutdown();
  } catch (err) {
    console.error("[Main] Error:", err);
    await shutdown();
  }
}

main();
