/**
 * Comprehensive example demonstrating all production features of the logger
 */

import {
  createBufferedTransport,
  createConfigurableLogger,
  createHttpTransport,
  createLogger,
  createOtelTraceProvider,
  // Middleware
  expressMiddleware,
  fastifyPlugin,
  // Transports
  HttpTransport,
  initializeRuntimeConfig,
  koaMiddleware,
  // OpenTelemetry
  OpenTelemetryAdapter,
} from "../src";

// =============================================================================
// 1. BASIC LOGGER WITH REDACTION
// =============================================================================

// Create a logger with sensitive data redaction
const logger = createLogger({
  level: "debug",
  service: "payment-service",
  env: "production",
  version: "1.2.3",

  // Enable data redaction for PII
  redaction: {
    enabled: true,
    paths: ["password", "credit_card", "ssn", "api_key"],
    customRedactor: (value, key) => {
      // Custom logic for specific fields
      if (key === "phone_number" && typeof value === "string") {
        return value.replace(/\d{6}(\d{4})/, "******$1");
      }
      return value;
    },
  },

  // Correlation ID for distributed tracing
  correlationId: () =>
    `trace-${Date.now()}-${Math.random().toString(36).substr(2, 9)}`,

  // OpenTelemetry trace provider
  traceProvider: createOtelTraceProvider(),

  // Custom adapters for external services
  adapters: [
    new OpenTelemetryAdapter({
      serviceName: "payment-service",
      exporters: {
        console: true,
        otlp: {
          endpoint: "http://localhost:4317",
          protocol: "grpc",
        },
      },
    }),
  ],
});

// Test redaction
logger.info("User login", {
  userId: "12345",
  email: "user@example.com",
  password: "secret123", // Will be redacted
  credit_card: "4111-1111-1111-1111", // Will be redacted
  phone_number: "1234567890", // Will be partially redacted
});

// =============================================================================
// 2. HTTP TRANSPORT WITH RETRY LOGIC
// =============================================================================

// Create HTTP transport for Datadog
const datadogTransport = createHttpTransport("datadog", {
  apiKey: process.env.DATADOG_API_KEY || "demo-key",
  batchSize: 50,
  flushInterval: 10000,
  maxRetries: 3,
  circuitBreaker: {
    threshold: 5,
    resetTimeout: 60000,
  },
});

// Create HTTP transport for Splunk
const splunkTransport = createHttpTransport("splunk", {
  url: "https://splunk.example.com:8088/services/collector",
  apiKey: process.env.SPLUNK_TOKEN || "demo-token",
  timeout: 5000,
});

// Create custom HTTP transport
const customTransport = new HttpTransport({
  url: "https://api.example.com/logs",
  method: "POST",
  headers: {
    "X-Custom-Header": "value",
  },
  auth: {
    type: "bearer",
    credentials: process.env.API_TOKEN || "demo-token",
  },
  transform: (records) => ({
    logs: records,
    metadata: {
      service: "payment-service",
      timestamp: Date.now(),
    },
  }),
});

// =============================================================================
// 3. BUFFERED TRANSPORT FOR PERFORMANCE
// =============================================================================

// Wrap HTTP transport with buffering for better performance
const bufferedTransport = createBufferedTransport(datadogTransport, {
  bufferSize: 1000,
  flushInterval: 5000,
  maxBatchSize: 100,
  onBufferFull: (records) => {
    console.warn(`Buffer full with ${records.length} records`);
  },
});

// Create logger with buffered transport
const performanceLogger = createLogger({
  level: "info",
  service: "high-throughput-service",
  adapters: [
    {
      name: "buffered-datadog",
      handle: async (rec) => {
        await bufferedTransport.write(
          rec,
          JSON.stringify(rec),
          rec.level === "error",
        );
      },
    },
  ],
});

// =============================================================================
// 4. EXPRESS MIDDLEWARE INTEGRATION
// =============================================================================

import express from "express";

const app = express();

// Add logger middleware with request context
app.use(
  expressMiddleware(logger, {
    logRequests: true,
    logResponses: true,
    includeHeaders: false,
    includeBody: true,
    correlationIdHeader: "x-trace-id",
    skip: (req, res) => {
      // Skip health check endpoints
      return req.path === "/health";
    },
  }),
);

// Example route using the logger
app.get("/api/payment", (req: any, res: any) => {
  // Logger is attached to request with correlation ID
  req.logger.info("Processing payment", {
    amount: 100.0,
    currency: "USD",
    userId: req.user?.id,
  });

  try {
    // Simulate payment processing
    const result = { success: true, transactionId: "txn-123" };
    req.logger.info("Payment successful", result);
    res.json(result);
  } catch (error) {
    req.logger.error("Payment failed", { error });
    res.status(500).json({ error: "Payment processing failed" });
  }
});

// =============================================================================
// 5. FASTIFY PLUGIN INTEGRATION
// =============================================================================

import fastify from "fastify";

const fastifyApp = fastify();

// Register logger plugin
fastifyApp.register(fastifyPlugin, {
  logger,
  logRequests: true,
  logResponses: true,
  generateCorrelationId: () => `fastify-${Date.now()}`,
});

// Example route
fastifyApp.get("/api/users", async (request: any, reply: any) => {
  request.logger.info("Fetching users");
  return { users: [] };
});

// =============================================================================
// 6. KOA MIDDLEWARE INTEGRATION
// =============================================================================

import Koa from "koa";

const koaApp = new Koa();

// Add logger middleware
koaApp.use(
  koaMiddleware(logger, {
    logRequests: true,
    logResponses: true,
    skip: (ctx) => ctx.path === "/metrics",
  }),
);

// Example middleware
koaApp.use(async (ctx: any) => {
  ctx.logger.info("Processing Koa request");
  ctx.body = { message: "Hello from Koa" };
});

// =============================================================================
// 7. RUNTIME LOG LEVEL CONFIGURATION
// =============================================================================

// Initialize runtime configuration
const runtimeConfig = initializeRuntimeConfig({
  configFile: "./log-config.json",
  watchConfig: true,
  enableHttpEndpoint: true,
  httpPort: 3001,
  enableSignalHandlers: true,
  defaultLevel: "info",
});

// Create configurable loggers
const apiLogger = createConfigurableLogger(
  "api",
  createLogger({
    level: "info",
    service: "api-service",
  }),
  runtimeConfig,
);

const dbLogger = createConfigurableLogger(
  "database",
  createLogger({
    level: "warn",
    service: "db-service",
  }),
  runtimeConfig,
);

// Log level can now be changed at runtime via:
// 1. HTTP API: PUT http://localhost:3001/config/global {"level": "debug"}
// 2. Signals: kill -USR1 <pid> (increase verbosity), kill -USR2 <pid> (decrease)
// 3. Config file changes (automatically reloaded)

// =============================================================================
// 8. ADVANCED USAGE EXAMPLES
// =============================================================================

// Child logger with additional context
const userLogger = logger.child({
  module: "user-service",
  userId: "user-123",
});

userLogger.info("User action", { action: "login" });

// Structured logging with different formats
const structuredLogger = createLogger({
  level: "info",
  structured: {
    type: "ecs", // Elastic Common Schema format
    map: (rec) => ({
      "@timestamp": new Date(rec.time).toISOString(),
      "log.level": rec.level,
      message: rec.msg,
      service: {
        name: rec.service,
        version: rec.version,
        environment: rec.env,
      },
      trace: {
        id: rec.traceId,
      },
      ...rec.context,
    }),
  },
});

// Sampling for high-volume logs
const sampledLogger = createLogger({
  level: "debug",
  sampling: {
    rates: {
      trace: 0.1, // Log 10% of trace messages
      debug: 0.5, // Log 50% of debug messages
      info: 1.0, // Log all info messages
    },
    defaultRate: 1.0,
  },
});

// Error handling with context
try {
  // Some operation
  throw new Error("Database connection failed");
} catch (error) {
  logger.error(
    "Operation failed",
    {
      operation: "database.connect",
      retries: 3,
      timeout: 5000,
    },
    error,
  );
}

// =============================================================================
// 9. MONITORING AND ALERTING EXAMPLE
// =============================================================================

// Create a monitoring logger that sends critical errors to multiple destinations
const monitoringLogger = createLogger({
  level: "info",
  service: "monitoring-service",
  adapters: [
    // Send to OpenTelemetry
    new OpenTelemetryAdapter({
      serviceName: "monitoring-service",
      samplingRate: 1.0,
    }),

    // Custom adapter for PagerDuty alerts
    {
      name: "pagerduty",
      level: "error",
      handle: async (rec) => {
        if (rec.level === "fatal") {
          // Send PagerDuty alert
          console.log("ALERT: Sending to PagerDuty", rec);
        }
      },
    },

    // Custom adapter for Slack notifications
    {
      name: "slack",
      level: "warn",
      handle: async (rec) => {
        if (rec.level === "error" || rec.level === "fatal") {
          // Send Slack notification
          console.log("NOTIFICATION: Sending to Slack", rec);
        }
      },
    },
  ],
});

// =============================================================================
// 10. CLEANUP
// =============================================================================

// Graceful shutdown
process.on("SIGTERM", async () => {
  logger.info("Shutting down gracefully");

  // Flush all pending logs
  await logger.flush();

  // Close transports
  await bufferedTransport.close();
  await datadogTransport.close();
  await splunkTransport.close();
  await customTransport.close();

  // Close runtime config
  await runtimeConfig.close();

  process.exit(0);
});

// Export for testing
export {
  apiLogger,
  dbLogger,
  logger,
  monitoringLogger,
  performanceLogger,
  sampledLogger,
  structuredLogger,
  userLogger,
};
