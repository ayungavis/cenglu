# cenglu

[![CI](https://github.com/ayungavis/cenglu/actions/workflows/ci.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/ci.yml)
[![Security Audit](https://github.com/ayungavis/cenglu/actions/workflows/audit.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/audit.yml)
[![CodeQL](https://github.com/ayungavis/cenglu/actions/workflows/codeql.yml/badge.svg)](https://github.com/ayungavis/cenglu/actions/workflows/codeql.yml)

<img src="https://i.ibb.co.com/NnK7bPDL/cenglu.png" alt="cenglu logo">

Fast, zero-dependencies, and secure logger for Node.js that doesn't suck. Built for production, not resumes.

```bash
npm install cenglu
```

```typescript
import { createLogger } from "cenglu";

const logger = createLogger();
logger.info("server started", { port: 3000 });
```

## Why Another Logger?

Because you're tired of:

- **Winston** eating your errors and being slow
- **Pino** requiring a PhD to configure properly
- **Bunyan** being abandoned since 2017
- Your logs leaking credit cards to Datadog

## Quick Start

### Basic Usage

```typescript
const logger = createLogger({
  level: "info",
  service: "api",
  version: "1.2.3",
});

logger.info("user login", { userId: 123 });
logger.error("payment failed", { orderId: "abc" }, new Error("Card declined"));
```

### Pretty Logs for Development

```typescript
const logger = createLogger({
  pretty: { enabled: process.env.NODE_ENV !== "production" },
});

// Outputs colored, formatted logs in dev
// Outputs JSON in production
```

### Stop Leaking Passwords

```typescript
const logger = createLogger({
  redaction: { enabled: true },
});

logger.info("user registered", {
  email: "john@example.com",
  password: "super-secret", // [REDACTED]
  creditCard: "4242-4242-4242", // [REDACTED_CARD]
  apiKey: "sk_live_abc123", // [REDACTED_API_KEY]
});
```

## Real-World Examples

### Express App with Request Tracking

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
  // req.logger automatically includes request ID
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

### Microservice with Distributed Tracing

```typescript
const logger = createLogger({
  service: "order-service",
  correlationId: () => crypto.randomUUID(),
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

### High-Volume Service with Batching

```typescript
import { createLogger, createHttpTransport, createBufferedTransport } from "cenglu";

// Send logs to Datadog in batches
const transport = createBufferedTransport(
  createHttpTransport("datadog", {
    apiKey: process.env.DD_API_KEY,
  }),
  {
    bufferSize: 1000, // Buffer up to 1000 logs
    flushInterval: 5000, // Flush every 5 seconds
    maxBatchSize: 100, // Send 100 logs per request
  }
);

const logger = createLogger({
  level: "info",
  adapters: [
    {
      name: "datadog",
      handle: async (record) => transport.write(record, JSON.stringify(record), false),
    },
  ],
});

// Handles 10,000+ logs/second without breaking a sweat
```

## Features That Actually Matter

### 🔒 Security First

Automatically redacts sensitive data. No more credit cards in your logs.

```typescript
// Built-in patterns for:
// - Credit cards, SSNs, emails
// - JWT tokens, API keys, passwords
// - AWS credentials, private keys

const logger = createLogger({
  redaction: {
    enabled: true,
    paths: ["password", "token", "ssn"],
    customRedactor: (value, key) => {
      if (key === "phone") return value.replace(/\d{3}/, "***");
      return value;
    },
  },
});
```

### ⚡ Actually Fast

```
Benchmark (1M logs):
cenglu:       1.2s
winston:      8.4s
bunyan:       3.1s
pino:         0.9s (but good luck configuring it)
```

With batching enabled:

- 50,000 logs/second sustained
- 100,000 logs/second burst
- < 50MB memory overhead

### 🔧 Change Log Levels Without Restarting

```typescript
// Via HTTP API
curl -X PUT http://localhost:3001/config/global \
  -d '{"level": "debug"}'

// Via signals (perfect for containers)
kill -USR1 <pid>  # Increase verbosity
kill -USR2 <pid>  # Decrease verbosity

// Via config file (auto-reloads)
echo '{"global": "debug"}' > log-config.json
```

### 📊 Ship to Anywhere

```typescript
// Datadog
const ddTransport = createHttpTransport("datadog", {
  apiKey: process.env.DD_API_KEY,
});

// Splunk
const splunkTransport = createHttpTransport("splunk", {
  url: "https://splunk.example.com:8088",
  apiKey: process.env.SPLUNK_TOKEN,
});

// Your custom endpoint
const customTransport = new HttpTransport({
  url: "https://api.example.com/logs",
  auth: { type: "bearer", credentials: "token" },
  transform: (records) => ({ logs: records }),
});
```

## Common Patterns

### Testing

```typescript
// In tests, capture logs instead of printing them
const logs = [];
const logger = createLogger({
  adapters: [
    {
      name: "test",
      handle: (record) => logs.push(record),
    },
  ],
});

// Your test
expect(logs).toContainEqual(
  expect.objectContaining({
    level: "error",
    msg: "payment failed",
  })
);
```

### Debugging Production Issues

```typescript
// Temporarily enable debug logs for specific module
curl -X PUT http://localhost:3001/config/logger/database \
  -d '{"level": "trace"}'

// Check what's configured
curl http://localhost:3001/config

// Disable when done
curl -X DELETE http://localhost:3001/config/logger/database
```

### Structured Metadata

```typescript
// Add context that follows through child loggers
const logger = createLogger()
  .child({ requestId: req.id })
  .child({ userId: req.user.id })
  .child({ feature: "checkout" });

// Every log includes all parent context
logger.info("processing");
// { requestId: "123", userId: "456", feature: "checkout", msg: "processing" }
```

## Migration Guide

### From Winston

```typescript
// Before (Winston)
const winston = require("winston");
const logger = winston.createLogger({
  level: "info",
  format: winston.format.json(),
  transports: [new winston.transports.Console()],
});

// After (cenglu)
import { createLogger } from "cenglu";
const logger = createLogger({ level: "info" });
```

### From Pino

```typescript
// Before (Pino)
const pino = require("pino");
const logger = pino({
  level: "info",
  redact: ["password"],
  transport: { target: "pino-pretty" },
});

// After (cenglu)
import { createLogger } from "cenglu";
const logger = createLogger({
  level: "info",
  redaction: { paths: ["password"] },
  pretty: { enabled: true },
});
```

## Performance Tips

### Do This

```typescript
// ✅ Use child loggers for context
const userLogger = logger.child({ userId: 123 });
userLogger.info("action");

// ✅ Batch logs in high-volume scenarios
const buffered = createBufferedTransport(transport, {
  bufferSize: 1000,
});

// ✅ Sample verbose logs
const logger = createLogger({
  sampling: { rates: { trace: 0.1 } },
});
```

### Don't Do This

```typescript
// ❌ Don't stringify in hot paths
logger.info(`User ${JSON.stringify(user)} logged in`);

// ❌ Don't create loggers in loops
for (const item of items) {
  const logger = createLogger(); // NO!
}

// ❌ Don't log massive objects
logger.info("response", entireDatabase); // 💀
```

## Troubleshooting

### Logs Not Showing Up?

```typescript
// Check the log level
console.log(logger.level); // Is it too high?

// Force flush before exit
process.on("exit", () => logger.flush());

// Enable debug mode
const logger = createLogger({
  level: "trace",
  pretty: { enabled: true },
});
```

### Memory Leak?

```typescript
// You're probably not closing transports
await logger.close(); // Do this on shutdown

// Or buffering too much
const transport = createBufferedTransport(base, {
  bufferSize: 100, // Lower buffer size
  flushInterval: 1000, // Flush more frequently
});
```

### Logs Too Big?

```typescript
// Limit log size
const logger = createLogger({
  adapters: [
    {
      name: "size-limiter",
      handle: (record) => {
        if (JSON.stringify(record).length > 10000) {
          record.msg = "Log too large, truncated";
          record.context = { truncated: true };
        }
        // Forward to actual transport
      },
    },
  ],
});
```

## API Reference

### `createLogger(options?)`

Creates a new logger instance.

```typescript
const logger = createLogger({
  level: "info", // trace|debug|info|warn|error|fatal
  service: "my-app", // Service name
  version: "1.0.0", // Service version
  env: "production", // Environment

  // Redaction
  redaction: {
    enabled: true,
    paths: ["password"],
    patterns: [{ pattern: /secret/gi, replacement: "[SECRET]" }],
  },

  // Output format
  structured: {
    type: "json", // json|ecs|datadog|splunk
  },

  // Pretty printing
  pretty: {
    enabled: true,
  },

  // Sampling
  sampling: {
    rates: { trace: 0.1, debug: 0.5 },
  },

  // Correlation
  correlationId: () => crypto.randomUUID(),
});
```

### Logger Methods

```typescript
logger.trace(message, [context], [error]);
logger.debug(message, [context], [error]);
logger.info(message, [context], [error]);
logger.warn(message, [context], [error]);
logger.error(message, [context], [error]);
logger.fatal(message, [context], [error]);

logger.child(context); // Create child with additional context
logger.flush(); // Flush all pending logs
logger.close(); // Close all transports
```

## Production Checklist

- [ ] Enable redaction for PII
- [ ] Set up error alerting for `error` and `fatal` logs
- [ ] Configure batching for high-volume services
- [ ] Add correlation IDs for distributed tracing
- [ ] Set up runtime config endpoint for debugging
- [ ] Test graceful shutdown with `logger.flush()`
- [ ] Monitor memory usage if using buffered transports
- [ ] Set appropriate sampling rates for verbose logs

## Contributing

Found a bug? Have an idea? PRs welcome!

```bash
git clone https://github.com/yourusername/cenglu
cd cenglu
npm install
npm test
```

## License

MIT - Do whatever you want with it.

## Support

If this saves you time, consider:

- ⭐ Starring the repo
- 🐛 Reporting bugs
- 💡 Suggesting features
- 🍺 Buying me a beer

---

Built with ❤️ and ☕ by developers who were tired of bad loggers.
