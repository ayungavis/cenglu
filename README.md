# cenglu

[![CI](https://github.com/ayungavis/cenglu/actions/workflows/ci.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/ci.yml)
[![Security Audit](https://github.com/ayungavis/cenglu/actions/workflows/audit.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/audit.yml)
[![CodeQL](https://github.com/ayungavis/cenglu/actions/workflows/codeql.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/codeql.yml)
[![Release](https://github.com/ayungavis/cenglu/actions/workflows/release.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/release.yml)
[![Size Limit](https://github.com/ayungavis/cenglu/actions/workflows/size.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/size.yml)

<img src="https://i.ibb.co.com/NnK7bPDL/cenglu.png" alt="cenglu logo">

Fast, zero-dependencies, and secure logger for Node.js that doesn't suck. Built for production, not resumes.

```bash
npm install cenglu
```

```typescript
import { createLogger } from "cenglu";

const logger = createLogger({
  service: "my-app",
  level: "info",
});
logger.info("server started", { port: 3000 });
````

## Why another logger?

- You're tired of heavy, leaky, or hard-to-configure loggers.
- cenglu focuses on security (built-in redaction), performance, and a small, predictable API.

## Quick start

### Basic usage

```typescript
import { createLogger } from "cenglu";

// Create a logger
const logger = createLogger({
  service: "my-app",
  level: "info",
});

// Basic logging
logger.info("Application started", { port: 3000 });
logger.warn("Deprecated API called", { endpoint: "/v1/users" });
logger.error("Failed to connect", new Error("Connection refused"));

// Child loggers for request context (shares transports/config)
const requestLogger = logger.child({ requestId: "abc-123" });
requestLogger.info("Processing request");

// Lightweight bound logger for temporary bindings
logger.with({ userId: 123 }).info("User action", { action: "login" });

// Timer for measuring durations
const done = logger.time("database-query");
await db.query("SELECT * FROM users");
done(); // Logs: "database-query completed" { durationMs: 42 }

// Timer result helpers
done.endWithContext({ rowCount: 10 });
const ms = done.elapsed();
````

### Pretty logs for development

```typescript
const logger = createLogger({
  pretty: { enabled: process.env.NODE_ENV !== "production" },
});

// Outputs colored, formatted logs in dev; JSON in production
````

### Stop leaking secrets

```typescript
const logger = createLogger({
  redaction: { enabled: true },
});

logger.info("user registered", {
  email: "john@example.com",
  password: "super-secret", // -> redacted
  creditCard: "4242-4242-4242", // -> redacted
  apiKey: "sk_live_abc123", // -> redacted
});
```

## Real-world examples

### Express app with request tracking

```typescript
import { createLogger, expressMiddleware } from "cenglu";

const logger = createLogger({ service: "api" });

app.use(
  expressMiddleware(logger, {
    logRequests: true,
    logResponses: true,
  })
);

app.post("/payment", (req, res) => {
  // req.logger is bound to the request (includes requestId)
  req.logger.info("processing payment", { amount: req.body.amount });

  try {
    const result = processPayment(req.body);
    req.logger.info("payment successful", { transactionId: result.id });
    res.json(result);
  } catch (error) {
    req.logger.error("payment failed", error);
    res.status(500).json({ error: "Payment failed" });
  }
});
```

### Plugin example — batching + HTTP sink

We've added a runnable example that demonstrates how to wire a batching plugin to send logs to an HTTP endpoint and how to enrich records with process/host metadata.

File: `logger/examples/plugin-example.ts`

What it does
- Starts a tiny local HTTP receiver that prints received batches.
- Creates a logger configured with `enrichPlugin` and `httpBatchingPlugin`.
- Emits a sequence of logs to exercise batching and error flush behavior.
- Demonstrates graceful shutdown with `logger.flush()` and `logger.close()`.

Run the example (quick):
```bash
# Run directly with ts-node (recommended for quick demo)
npx ts-node logger/examples/plugin-example.ts

# Or compile and run
npx tsc logger/examples/plugin-example.ts --esModuleInterop --module es2022 --target es2022
node logger/examples/plugin-example.js
```

Why this example is useful
- Shows recommended plugin usage patterns: keep `onRecord()` lightweight, use batching for network sinks, and call `flush()`/`close()` during shutdown.
- Provides a concrete testbed for experimenting with `maxBatchSize`, `maxWaitMs`, `transform`, and enrichment options.

Tip: when integrating with a real ingestion endpoint, replace the local receiver URL in the example with your endpoint and adjust headers/transform accordingly.

### Microservice with distributed tracing

```typescript
const logger = createLogger({
  service: "order-service",
  correlationId: () => crypto.randomUUID(),
  traceProvider: () => ({ traceId: /* from tracer */ "", spanId: "" }),
});

// All logs include correlation ID automatically
async function processOrder(order) {
  const orderLogger = logger.child({ orderId: order.id });

  orderLogger.info("processing order");
  await validateInventory(order);
  orderLogger.info("inventory validated");

  await chargePayment(order);
  orderLogger.info("payment processed");

  return order;
}
```

### High-volume service with batching (adapter example)

```typescript
import { createLogger, createHttpTransport, createBufferedTransport } from "cenglu";

// Build a buffered transport to send batches to Datadog
const transport = createBufferedTransport(
  createHttpTransport("datadog", {
    apiKey: process.env.DD_API_KEY,
  }),
  {
    bufferSize: 1000,
    flushInterval: 5000,
    maxBatchSize: 100,
  }
);

const logger = createLogger({
  level: "info",
  adapters: [
    {
      name: "datadog-adapter",
      // adapters can be sync or async (return Promise)
      handle: async (record) => transport.write(record, JSON.stringify(record), false),
    },
  ],
});
```

## Features that matter

### Security-first redaction

- Built-in patterns for common secrets (credit cards, emails, JWTs, API keys, passwords).
- Redaction applies to `msg`, `context`, and `err` via the `Redactor`.
- `redaction` options support `paths`, `patterns`, and a `customRedactor` function.

### Fast and predictable

- Designed for high throughput and low overhead.
- Sampling support to reduce verbose log volume.

### Change log level without restart

- Programmatically: `logger.setLevel("debug")` and `logger.getLevel()`.
- `logger.isLevelEnabled(level)` is provided to guard expensive computations.

### Ship to any backend

- Adapters and transports let you forward logs to custom destinations.
- Adapters may include an optional `level` to filter which records they receive.

### Plugin system

- Plugins are initialized in order and may implement hooks:
  - `onInit(logger)`
  - `onRecord(record)` — can return `null` to drop a record, return a transformed `record`, or return `undefined` to leave it unchanged.
  - `onFormat(record, formatted)` — may replace formatted output
  - `onWrite(record, formatted)`
  - `onFlush()`
  - `onClose()`
- Plugin errors are caught and written to stderr; they don't crash the process.

### File transport configuration & rotation

- File transport is disabled by default (enable with options or env).
- Rotation options can be set via environment variables:
  - `LOG_ROTATE_DAYS` — rotation interval in days
  - `LOG_MAX_BYTES` — maximum bytes before rotation
  - `LOG_MAX_FILES` — number of rotated files to keep
  - `LOG_COMPRESS` — "gzip" to compress rotated files, "false"/"0" to disable compression
  - `LOG_RETENTION_DAYS` — how long to keep rotated logs
  - `LOG_DIR` — directory to write logs
- The file transport supports writing a separate errors file when configured.

## API reference

```typescript
createLogger(options?)

const logger = createLogger({
  level: "info", // trace|debug|info|warn|error|fatal
  service: "my-app",
  version: "1.0.0",
  env: "production",

  // Redaction
  redaction: {
    enabled: true,
    paths: ["password"],
    patterns: [{ pattern: /secret/gi, replacement: "[SECRET]" }],
  },

  // Structured output
  structured: {
    type: "json", // json|ecs|datadog|splunk|logfmt
    transform: (record) => ({ ...record, extra: true }), // optional transform before stringifying
  },

  // Pretty printing
  pretty: {
    enabled: true,
    theme: {},
    formatter: (record) => String(record.msg),
  },

  // Sampling
  sampling: {
    rates: { trace: 0.1, debug: 0.5 },
    defaultRate: 1,
  },

  correlationId: () => crypto.randomUUID(),
  traceProvider: () => ({ traceId: "abc", spanId: "def" }),

  // Test helpers
  now: Date.now,
  random: Math.random,
  useAsyncContext: true,

  adapters: [{ name: "my-adapter", handle: (record) => {/* ... */} }],
  transports: [/* Transport instances */],
  plugins: [/* LoggerPlugin instances */],
});
```

## Logger instance methods

- `logger.trace(message, [context], [error])`
- `logger.debug(message, [context], [error])`
- `logger.info(message, [context], [error])`
- `logger.warn(message, [context], [error])`
- `logger.error(message, [context], [error])`
- `logger.fatal(message, [context], [error])`

- `logger.with(context)` — returns a lightweight `BoundLogger` that binds context for single-call convenience.
- `logger.child(bindings)` — creates a child `Logger` that shares transports/config but merges new bindings into the logger state.
  - Child loggers share resources; do not `close()` child loggers directly — close the parent.
- `logger.logAt(level, msg, context?)` — dynamic-level logging.
- `logger.ifTrace(fn)`, `logger.ifDebug(fn)`, `logger.ifInfo(fn)` — conditional helpers that run `fn` only if that level is enabled. `fn` should return `[msg, context?]`.
- `logger.time(label, context?)` — returns a callable timer that logs the completed duration when called. The timer also exposes:
  - `.end()` — same as calling the timer
  - `.elapsed()` — returns elapsed milliseconds
  - `.endWithContext(extraContext)` — ends and logs with merged context
- `logger.setLevel(level)` — validate and set a new minimum level
- `logger.getLevel()` — read the current level
- `logger.isLevelEnabled(level)` — true if logs at `level` would be emitted
- `await logger.flush()` — flush plugins and transports
- `await logger.close()` — flush, then close plugins and transports (parent only)

## Advanced patterns

### Testing

```typescript
const logs = [];
const logger = createLogger({
  adapters: [
    {
      name: "test",
      handle: (record) => logs.push(record),
    },
  ],
});

expect(logs).toContainEqual(expect.objectContaining({ level: "error", msg: "payment failed" }));
```

### Plugins

```typescript
const auditPlugin = {
  name: "audit",
  order: 50,
  onInit(logger) { /* called once */ },
  onRecord(record) {
    // Return null to drop, return transformed record or undefined to keep
    if (record.context?.sensitive) return null;
    return record;
  },
  onFormat(record, formatted) { return formatted; },
  onWrite(record, formatted) { /* called after write */ },
  onFlush() { /* optional async */ },
  onClose() { /* optional async */ },
};
```

### Adapters

```typescript
const myAdapter = {
  name: "metrics",
  level: "info", // optional level threshold
  handle(record) {
    metricsClient.send(record);
  },
};
```

## Troubleshooting

### Logs not showing?

- Confirm your logger level: `logger.getLevel()` isn't higher than the messages you expect.
- Ensure transports and adapters are configured and not closed.
- Call `await logger.flush()` before process exit.

### Memory leaks?

- Ensure you call `await logger.close()` on shutdown to close transports and plugins.
- Avoid very large buffers in buffered transports; reduce `bufferSize` or flush interval if needed.

### Logs too big?

- Use redaction and plugins/adapters to truncate or transform large payloads before forwarding.

## Production checklist

- [ ] Enable redaction for PII
- [ ] Configure batching/adapters for high-volume ingestion
- [ ] Add correlation IDs for distributed traces
- [ ] Test `logger.flush()` and `logger.close()` during graceful shutdown
- [ ] Monitor memory if using buffered transports
- [ ] Set appropriate sampling rates for verbose logs

## Contributing

```bash
git clone https://github.com/yourusername/cenglu
cd cenglu
bun install
bun run test
```

## License

MIT

## Support

If this saves you time, consider:

- ⭐ Starring the repo
- 🐛 Reporting bugs
- 💡 Suggesting features
- 🍺 Buying me a beer

---

Built with ❤️ and ☕ by developers who were tired of bad loggers.
