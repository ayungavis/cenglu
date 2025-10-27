/**
 * Comprehensive Hono integration example with cenglu logger
 *
 * This example demonstrates:
 * - Hono middleware integration with cenglu
 * - Request/response logging with correlation IDs
 * - Error handling and logging
 * - Child logger usage in routes
 * - Data redaction for sensitive information
 * - Performance logging and sampling
 * - Multiple transport configurations
 */

import { Hono } from "hono";
import { cors } from "hono/cors";
import { logger as honoLogger } from "hono/logger";
import {
  createBufferedTransport,
  createHttpTransport,
  createLogger,
  // Hono middleware
  honoMiddleware,
  // Utilities
  createCorrelationIdGenerator,
} from "../src";

// =============================================================================
// 1. LOGGER CONFIGURATION
// =============================================================================

// Main logger with redaction and structured output
const mainLogger = createLogger({
  level: "info",
  service: "hono-api",
  env: process.env.NODE_ENV || "development",
  version: "1.0.0",

  // Enable automatic redaction of sensitive data
  redaction: {
    enabled: true,
    paths: ["password", "token", "apiKey", "creditCard", "ssn"],
    defaultPatterns: true, // Use built-in patterns for common sensitive data
  },

  // Custom correlation ID generator
  correlationId: createCorrelationIdGenerator("uuid"),

  // Pretty printing for development
  pretty: {
    enabled: process.env.NODE_ENV !== "production",
  },

  // Structured JSON output for production
  structured: {
    type: process.env.NODE_ENV === "production" ? "json" : "pretty",
  },
});

// Performance logger with sampling for high-volume operations
const performanceLogger = createLogger({
  level: "debug",
  service: "hono-api-performance",

  // Sample only 10% of debug logs to reduce noise
  sampling: {
    rates: {
      debug: 0.1,
      trace: 0.05,
      info: 1.0,
      warn: 1.0,
      error: 1.0,
      fatal: 1.0,
    },
  },
});

// Error-only logger for monitoring and alerts
const errorLogger = createLogger({
  level: "error",
  service: "hono-api-errors",

  // Send errors to external monitoring service
  adapters: [
    {
      name: "error-monitoring",
      handle: async (rec) => {
        if (rec.level === "error" || rec.level === "fatal") {
          // Send to your error monitoring service (e.g., Sentry, DataDog)
          console.error("ERROR ALERT:", JSON.stringify(rec, null, 2));
        }
      },
    },
  ],
});

// =============================================================================
// 2. HONO APPLICATION SETUP
// =============================================================================

const app = new Hono();

// Add CORS middleware
app.use(
  "*",
  cors({
    origin: "*",
    allowMethods: ["GET", "POST", "PUT", "DELETE", "OPTIONS"],
    allowHeaders: ["Content-Type", "Authorization", "X-Correlation-ID"],
  }),
);

// Add basic Hono logger (optional, for HTTP access logs)
app.use("*", honoLogger());

// Add cenglu middleware with custom configuration
app.use(
  "*",
  honoMiddleware(mainLogger, {
    logRequests: true,
    logResponses: true,
    includeHeaders: false, // Set to true for debugging
    includeBody: process.env.NODE_ENV === "development", // Only include body in development
    correlationIdHeader: "x-correlation-id",
    generateCorrelationId: createCorrelationIdGenerator("timestamp"),
    skip: (c) => {
      // Skip logging for health checks and metrics
      const path = c.req.path;
      return (
        path === "/health" || path === "/metrics" || path.startsWith("/static/")
      );
    },
  }),
);

// =============================================================================
// 3. AUTHENTICATION MIDDLEWARE
// =============================================================================

const authMiddleware = async (c: any, next: any) => {
  const logger = c.get("logger");
  const correlationId = c.get("correlationId");

  // Extract authorization header
  const authHeader = c.req.header("authorization");
  const apiKey = c.req.header("x-api-key");

  logger.debug("Auth check", { hasAuth: !!authHeader, hasApiKey: !!apiKey });

  // Simple API key authentication for demo
  if (apiKey !== "demo-api-key-12345" && !authHeader) {
    logger.warn("Unauthorized request", {
      ip: c.req.header("x-forwarded-for"),
      userAgent: c.req.header("user-agent"),
    });

    return c.json({ error: "Unauthorized" }, 401);
  }

  // Add user context to logger
  const userLogger = logger.child({
    userId: "user-123",
    role: "authenticated",
    authMethod: apiKey ? "api-key" : "bearer-token",
  });

  c.set("logger", userLogger);
  await next();
};

// =============================================================================
// 4. API ROUTES
// =============================================================================

// Health check endpoint (no logging due to skip config)
app.get("/health", (c) => {
  return c.json({
    status: "ok",
    timestamp: new Date().toISOString(),
    service: "hono-api",
    version: "1.0.0",
  });
});

// Root endpoint
app.get("/", (c) => {
  const logger = c.get("logger");

  logger.info("Root endpoint accessed");

  return c.json({
    message: "Hono API with cenglu logging",
    version: "1.0.0",
    endpoints: [
      "GET /",
      "GET /users",
      "POST /users",
      "GET /products",
      "POST /orders",
      "GET /health",
      "GET /metrics",
    ],
  });
});

// Get users with performance logging
app.get("/users", authMiddleware, async (c) => {
  const logger = c.get("logger");
  const perfLogger = performanceLogger.child({
    operation: "get-users",
    userId: c.get("userId"),
  });

  const startTime = Date.now();

  try {
    logger.info("Fetching users");
    perfLogger.debug("Database query started", {
      query: "SELECT * FROM users",
    });

    // Simulate database delay
    await new Promise((resolve) => setTimeout(resolve, 50));

    const users = [
      { id: 1, name: "John Doe", email: "john@example.com" },
      { id: 2, name: "Jane Smith", email: "jane@example.com" },
    ];

    const duration = Date.now() - startTime;
    perfLogger.info("Users fetched successfully", {
      userCount: users.length,
      duration,
      performance: duration < 100 ? "good" : "slow",
    });

    logger.info("Returning users", { count: users.length });

    return c.json({
      success: true,
      data: users,
      meta: {
        count: users.length,
        duration: `${duration}ms`,
      },
    });
  } catch (error) {
    const duration = Date.now() - startTime;
    logger.error("Failed to fetch users", { duration }, error);
    errorLogger.error(
      "Database error",
      { operation: "get-users", duration },
      error,
    );

    return c.json(
      {
        success: false,
        error: "Failed to fetch users",
      },
      500,
    );
  }
});

// Create user with data redaction demo
app.post("/users", authMiddleware, async (c) => {
  const logger = c.get("logger");

  try {
    const body = await c.req.json();

    logger.info("Creating new user", {
      email: body.email,
      name: body.name,
      // Password will be automatically redacted
      password: body.password, // This will show as [REDACTED]
      creditCard: body.creditCard, // This will show as [REDACTED_CARD]
      ssn: body.ssn, // This will show as [REDACTED]
    });

    // Simulate user creation
    const newUser = {
      id: Math.floor(Math.random() * 1000),
      name: body.name,
      email: body.email,
      createdAt: new Date().toISOString(),
    };

    logger.info("User created successfully", {
      userId: newUser.id,
      email: newUser.email,
    });

    return c.json(
      {
        success: true,
        data: newUser,
      },
      201,
    );
  } catch (error) {
    logger.error("Failed to create user", {}, error);

    return c.json(
      {
        success: false,
        error: "Invalid request data",
      },
      400,
    );
  }
});

// Get products with child logger pattern
app.get("/products", async (c) => {
  const logger = c.get("logger");

  // Create child logger for this operation
  const productLogger = logger.child({
    module: "products",
    operation: "list-products",
  });

  try {
    productLogger.debug("Fetching products from database");

    // Simulate different categories
    const categories = c.req.query("category")?.split(",") || [];

    const products = [
      { id: 1, name: "Laptop", price: 999.99, category: "electronics" },
      { id: 2, name: "Book", price: 19.99, category: "books" },
      { id: 3, name: "Coffee", price: 4.99, category: "food" },
    ].filter(
      (product) =>
        categories.length === 0 || categories.includes(product.category),
    );

    productLogger.info("Products retrieved", {
      count: products.length,
      categories: categories.length > 0 ? categories : "all",
    });

    return c.json({
      success: true,
      data: products,
      filters: { categories },
    });
  } catch (error) {
    productLogger.error("Failed to fetch products", {}, error);

    return c.json(
      {
        success: false,
        error: "Failed to fetch products",
      },
      500,
    );
  }
});

// Create order with comprehensive logging
app.post("/orders", authMiddleware, async (c) => {
  const logger = c.get("logger");
  const correlationId = c.get("correlationId");

  // Create specialized logger for order processing
  const orderLogger = logger.child({
    module: "orders",
    operation: "create-order",
    traceId: correlationId,
  });

  const startTime = Date.now();

  try {
    const body = await c.req.json();

    orderLogger.info("Order creation started", {
      userId: c.get("userId"),
      items: body.items?.length || 0,
      totalAmount: body.totalAmount,
    });

    // Validate order
    if (!body.items || body.items.length === 0) {
      orderLogger.warn("Invalid order: no items", { body });
      return c.json(
        {
          success: false,
          error: "Order must contain at least one item",
        },
        400,
      );
    }

    // Simulate order processing steps
    orderLogger.debug("Validating inventory");
    await new Promise((resolve) => setTimeout(resolve, 20));

    orderLogger.debug("Processing payment");
    await new Promise((resolve) => setTimeout(resolve, 100));

    // Simulate payment processing
    if (body.totalAmount > 1000) {
      throw new Error("Payment amount exceeds limit");
    }

    const order = {
      id: `order-${Date.now()}-${Math.random().toString(36).substr(2, 5)}`,
      userId: c.get("userId"),
      items: body.items,
      totalAmount: body.totalAmount,
      status: "completed",
      createdAt: new Date().toISOString(),
    };

    const duration = Date.now() - startTime;

    orderLogger.info("Order created successfully", {
      orderId: order.id,
      totalAmount: order.totalAmount,
      duration,
      status: order.status,
    });

    performanceLogger.info("Order processing performance", {
      operation: "create-order",
      duration,
      itemCount: body.items.length,
      performance:
        duration < 200 ? "excellent" : duration < 500 ? "good" : "slow",
    });

    return c.json({
      success: true,
      data: order,
      processingTime: `${duration}ms`,
    });
  } catch (error) {
    const duration = Date.now() - startTime;

    orderLogger.error(
      "Order creation failed",
      {
        duration,
        userId: c.get("userId"),
      },
      error,
    );

    errorLogger.error(
      "Order processing error",
      {
        operation: "create-order",
        duration,
        userId: c.get("userId"),
        correlationId,
      },
      error,
    );

    return c.json(
      {
        success: false,
        error: "Failed to create order",
        orderId: null,
      },
      500,
    );
  }
});

// Metrics endpoint
app.get("/metrics", (c) => {
  const logger = c.get("logger");

  logger.debug("Metrics accessed");

  // Simulate some metrics
  const metrics = {
    uptime: process.uptime(),
    memory: process.memoryUsage(),
    requests: {
      total: 1234,
      success: 1200,
      error: 34,
    },
    performance: {
      avgResponseTime: 125,
      p95ResponseTime: 300,
      p99ResponseTime: 800,
    },
  };

  return c.json(metrics);
});

// =============================================================================
// 5. ERROR HANDLING
// =============================================================================

// Global error handler
app.onError((err, c) => {
  const logger = c.get("logger");
  const correlationId = c.get("correlationId");

  logger.error(
    "Unhandled error",
    {
      path: c.req.path,
      method: c.req.method,
      correlationId,
    },
    err,
  );

  errorLogger.error(
    "Unhandled application error",
    {
      path: c.req.path,
      method: c.req.method,
      correlationId,
      stack: err.stack,
    },
    err,
  );

  return c.json(
    {
      success: false,
      error: "Internal server error",
      correlationId,
    },
    500,
  );
});

// 404 handler
app.notFound((c) => {
  const logger = c.get("logger");

  logger.warn("Route not found", {
    path: c.req.path,
    method: c.req.method,
  });

  return c.json(
    {
      success: false,
      error: "Route not found",
      path: c.req.path,
      method: c.req.method,
    },
    404,
  );
});

// =============================================================================
// 6. HTTP TRANSPORT CONFIGURATION (Optional)
// =============================================================================

// Uncomment to enable HTTP transport for external logging services
if (process.env.DATADOG_API_KEY) {
  const datadogTransport = createHttpTransport("datadog", {
    apiKey: process.env.DATADOG_API_KEY,
    batchSize: 50,
    flushInterval: 5000,
  });

  mainLogger.adapters.push({
    name: "datadog",
    handle: async (rec) => {
      await datadogTransport.write(
        rec,
        JSON.stringify(rec),
        rec.level === "error",
      );
    },
  });
}

// =============================================================================
// 7. GRACEFUL SHUTDOWN
// =============================================================================

const gracefulShutdown = async (signal: string) => {
  console.log(`\nReceived ${signal}. Starting graceful shutdown...`);

  try {
    // Flush all pending logs
    await mainLogger.flush();
    await performanceLogger.flush();
    await errorLogger.flush();

    console.log("All logs flushed. Shutting down gracefully.");
    process.exit(0);
  } catch (error) {
    console.error("Error during graceful shutdown:", error);
    process.exit(1);
  }
};

// Handle shutdown signals
process.on("SIGTERM", () => gracefulShutdown("SIGTERM"));
process.on("SIGINT", () => gracefulShutdown("SIGINT"));

// =============================================================================
// 8. START SERVER
// =============================================================================

const port = parseInt(process.env.PORT || "3000", 10);

console.log(`🚀 Hono server starting on port ${port}`);
console.log(`📊 Environment: ${process.env.NODE_ENV || "development"}`);
console.log(`📍 Health check: http://localhost:${port}/health`);
console.log(`📖 API docs: http://localhost:${port}/`);

// Export the app for testing
export default app;

// Start server if this file is run directly
if (import.meta.main) {
  // Note: In a real application, you would use:
  // import { serve } from "@hono/node-server";
  // serve({ fetch: app.fetch, port });

  console.log("📝 Note: Use a Hono server adapter to run this application");
  console.log("📝 Example: bun run @hono/node-server examples/hono-example.ts");
}
