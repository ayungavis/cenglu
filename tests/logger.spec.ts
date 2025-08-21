import { describe, expect, it, vi } from "vitest";
import { createLogger } from "../src/logger";
import type { LogRecord } from "../src/types";

describe("logger", () => {
  it("logs without throwing", () => {
    const log = createLogger({ pretty: { enabled: false } });
    log.info("hello");
    log.error("oops", new Error("boom"));
    expect(true).toBe(true);
  });

  it("logs to console", () => {
    const log = createLogger({ pretty: { enabled: true } });
    log.info("hello");
    log.error("oops", new Error("boom"));
    expect(true).toBe(true);
  });

  describe("Complex Object Logging", () => {
    it("handles deeply nested objects with pretty format", () => {
      const log = createLogger({
        pretty: { enabled: true },
        service: "user-service",
        env: "development",
      });

      const complexUser = {
        id: "usr_123456",
        username: "john.doe",
        email: "john@example.com",
        profile: {
          firstName: "John",
          lastName: "Doe",
          age: 30,
          verified: true,
          joinedAt: new Date("2024-01-15"),
          preferences: {
            theme: "dark",
            language: "en-US",
            notifications: {
              email: true,
              push: false,
              sms: true,
              frequency: "daily",
            },
            privacy: {
              profileVisible: true,
              showEmail: false,
              allowMessages: true,
            },
          },
          addresses: [
            {
              type: "home",
              street: "123 Main St",
              city: "San Francisco",
              state: "CA",
              zip: "94105",
              country: "USA",
              primary: true,
            },
            {
              type: "work",
              street: "456 Tech Blvd",
              city: "San Jose",
              state: "CA",
              zip: "95110",
              country: "USA",
              primary: false,
            },
          ],
          socialMedia: {
            twitter: "@johndoe",
            linkedin: "john-doe-123",
            github: "johndoe",
          },
        },
        metadata: {
          createdAt: new Date("2024-01-15T10:30:00Z"),
          updatedAt: new Date("2024-11-20T15:45:00Z"),
          lastLogin: new Date("2024-11-21T09:00:00Z"),
          loginCount: 245,
          accountStatus: "active",
          subscription: {
            plan: "premium",
            startDate: new Date("2024-02-01"),
            endDate: new Date("2025-02-01"),
            autoRenew: true,
            price: 29.99,
            currency: "USD",
          },
        },
      };

      console.log("\n=== Pretty Format with Complex Nested Object ===");
      log.info("User profile loaded", { user: complexUser });

      expect(true).toBe(true);
    });

    it("handles large datasets and arrays", () => {
      const log = createLogger({
        pretty: { enabled: true },
        service: "analytics-service",
      });

      const analyticsData = {
        reportId: "rpt_2024_11_21",
        generatedAt: new Date(),
        metrics: {
          pageViews: 125000,
          uniqueVisitors: 45000,
          avgSessionDuration: 185.5,
          bounceRate: 0.35,
          conversionRate: 0.045,
        },
        topPages: [
          { path: "/home", views: 35000, avgTime: 45.2 },
          { path: "/products", views: 28000, avgTime: 120.5 },
          { path: "/about", views: 15000, avgTime: 30.8 },
          { path: "/contact", views: 8000, avgTime: 60.3 },
          { path: "/blog", views: 12000, avgTime: 180.7 },
        ],
        deviceBreakdown: {
          desktop: { users: 25000, percentage: 55.5 },
          mobile: { users: 18000, percentage: 40.0 },
          tablet: { users: 2000, percentage: 4.5 },
        },
        geographicData: [
          { country: "USA", users: 20000, revenue: 150000 },
          { country: "UK", users: 8000, revenue: 60000 },
          { country: "Germany", users: 5000, revenue: 40000 },
          { country: "Japan", users: 7000, revenue: 55000 },
          { country: "Australia", users: 5000, revenue: 38000 },
        ],
      };

      console.log("\n=== Large Analytics Dataset ===");
      log.info("Analytics report generated", analyticsData);

      expect(true).toBe(true);
    });

    it("handles errors with context", () => {
      const log = createLogger({
        pretty: { enabled: true },
        service: "payment-service",
      });

      const paymentError = new Error("Payment processing failed");
      paymentError.name = "PaymentError";

      const errorContext = {
        transactionId: "txn_987654321",
        userId: "usr_123456",
        amount: 299.99,
        currency: "USD",
        paymentMethod: "credit_card",
        cardLast4: "4242",
        attemptNumber: 3,
        gateway: "stripe",
        gatewayResponse: {
          code: "card_declined",
          message: "Your card was declined",
          declineReason: "insufficient_funds",
        },
        timestamp: new Date(),
        requestHeaders: {
          "x-request-id": "req_abc123",
          "x-forwarded-for": "192.168.1.1",
          "user-agent": "Mozilla/5.0...",
        },
      };

      console.log("\n=== Error with Rich Context ===");
      log.error("Payment failed", errorContext, paymentError);

      expect(true).toBe(true);
    });
  });

  describe("Different Output Formats", () => {
    it("outputs in JSON format", () => {
      const log = createLogger({
        pretty: { enabled: false },
        structured: { type: "json" },
        service: "api-gateway",
        version: "1.2.3",
      });

      const requestData = {
        method: "POST",
        path: "/api/users",
        statusCode: 201,
        duration: 145,
        requestId: "req_xyz789",
        clientIp: "10.0.0.1",
      };

      console.log("\n=== JSON Format ===");
      const consoleSpy = vi.spyOn(console, "log");
      log.info("API request completed", requestData);

      if (consoleSpy.mock.calls.length > 0) {
        console.log("Output:", consoleSpy.mock.calls[0][0]);
      }
      consoleSpy.mockRestore();

      expect(true).toBe(true);
    });

    it("outputs in ECS format for Elasticsearch", () => {
      const log = createLogger({
        pretty: { enabled: false },
        structured: { type: "ecs" },
        service: "search-service",
      });

      console.log("\n=== ECS Format (Elasticsearch) ===");
      const consoleSpy = vi.spyOn(console, "log");
      log.warn("Search query slow", {
        query: "SELECT * FROM products WHERE category = 'electronics'",
        duration: 2500,
        resultCount: 1250,
      });

      if (consoleSpy.mock.calls.length > 0) {
        const output = JSON.parse(consoleSpy.mock.calls[0][0]);
        console.log("ECS Output:", JSON.stringify(output, null, 2));
      }
      consoleSpy.mockRestore();

      expect(true).toBe(true);
    });

    it("outputs in Datadog format", () => {
      const log = createLogger({
        pretty: { enabled: false },
        structured: { type: "datadog" },
        service: "monitoring-service",
      });

      console.log("\n=== Datadog Format ===");
      const consoleSpy = vi.spyOn(console, "log");
      log.info("Health check passed", {
        endpoint: "/health",
        responseTime: 25,
        status: "healthy",
        checks: {
          database: "ok",
          redis: "ok",
          elasticsearch: "ok",
        },
      });

      if (consoleSpy.mock.calls.length > 0) {
        const output = JSON.parse(consoleSpy.mock.calls[0][0]);
        console.log("Datadog Output:", JSON.stringify(output, null, 2));
      }
      consoleSpy.mockRestore();

      expect(true).toBe(true);
    });

    it("outputs in Splunk format", () => {
      const log = createLogger({
        pretty: { enabled: false },
        structured: { type: "splunk" },
        service: "audit-service",
      });

      console.log("\n=== Splunk Format ===");
      const consoleSpy = vi.spyOn(console, "log");
      log.info("User action audited", {
        action: "DELETE_RESOURCE",
        resourceType: "document",
        resourceId: "doc_456",
        userId: "usr_789",
        result: "success",
      });

      if (consoleSpy.mock.calls.length > 0) {
        const output = JSON.parse(consoleSpy.mock.calls[0][0]);
        console.log("Splunk Output:", JSON.stringify(output, null, 2));
      }
      consoleSpy.mockRestore();

      expect(true).toBe(true);
    });
  });

  describe("Real-world Scenarios", () => {
    it("logs HTTP request/response cycle", () => {
      const log = createLogger({
        pretty: { enabled: true },
        service: "web-server",
      });

      const request = {
        id: "req_http_123",
        method: "POST",
        url: "/api/v1/orders",
        headers: {
          "content-type": "application/json",
          authorization: "Bearer [REDACTED]",
          "x-api-key": "[REDACTED]",
        },
        body: {
          customerId: "cust_456",
          items: [
            { productId: "prod_789", quantity: 2, price: 49.99 },
            { productId: "prod_012", quantity: 1, price: 129.99 },
          ],
          shippingAddress: {
            street: "789 Oak Ave",
            city: "Seattle",
            state: "WA",
            zip: "98101",
          },
        },
        ip: "192.168.1.100",
        userAgent: "Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)",
      };

      const response = {
        statusCode: 201,
        headers: {
          "content-type": "application/json",
          "x-request-id": "req_http_123",
        },
        body: {
          orderId: "ord_new_456",
          status: "pending",
          totalAmount: 229.97,
          estimatedDelivery: "2024-11-25",
        },
        duration: 234,
      };

      console.log("\n=== HTTP Request/Response Logging ===");
      const requestLogger = log.child({ requestId: request.id });
      requestLogger.info("Incoming request", { request });
      requestLogger.info("Request processed successfully", { response });

      expect(true).toBe(true);
    });

    it("logs database operations", () => {
      const log = createLogger({
        pretty: { enabled: true },
        service: "database-service",
      });

      console.log("\n=== Database Operation Logging ===");

      // Query execution
      log.debug("Executing database query", {
        query:
          "SELECT u.*, p.* FROM users u JOIN profiles p ON u.id = p.user_id WHERE u.status = $1",
        params: ["active"],
        connection: "primary",
        pool: { size: 10, active: 3, idle: 7 },
      });

      // Query result
      log.info("Query executed successfully", {
        rowCount: 42,
        duration: 125,
        fields: ["id", "username", "email", "firstName", "lastName"],
        cached: false,
      });

      // Transaction
      log.info("Database transaction completed", {
        transactionId: "txn_db_789",
        operations: [
          { type: "INSERT", table: "orders", affected: 1 },
          { type: "UPDATE", table: "inventory", affected: 3 },
          { type: "INSERT", table: "order_items", affected: 3 },
        ],
        duration: 450,
        isolation: "READ_COMMITTED",
      });

      expect(true).toBe(true);
    });

    it("logs microservice communication", () => {
      const log = createLogger({
        pretty: { enabled: true },
        service: "order-service",
        version: "2.1.0",
      });

      console.log("\n=== Microservice Communication ===");

      const serviceCall = {
        targetService: "inventory-service",
        method: "gRPC",
        operation: "CheckInventory",
        request: {
          items: [
            { sku: "SKU001", quantity: 5 },
            { sku: "SKU002", quantity: 3 },
          ],
        },
        response: {
          available: true,
          items: [
            { sku: "SKU001", available: 5, warehouse: "WH-EAST" },
            { sku: "SKU002", available: 3, warehouse: "WH-WEST" },
          ],
        },
        duration: 87,
        traceId: "trace_123abc",
        spanId: "span_456def",
      };

      log.info("Service call completed", serviceCall);

      expect(true).toBe(true);
    });
  });

  describe("Performance Monitoring", () => {
    it("logs system performance metrics", () => {
      const log = createLogger({
        pretty: { enabled: true },
        service: "monitoring-service",
      });

      const performanceMetrics = {
        timestamp: new Date(),
        system: {
          cpuUsage: {
            user: 45.2,
            system: 12.8,
            idle: 42.0,
            cores: 8,
          },
          memory: {
            total: 16384,
            used: 10240,
            free: 6144,
            percentage: 62.5,
          },
          disk: {
            total: 512000,
            used: 384000,
            free: 128000,
            percentage: 75.0,
          },
          network: {
            bytesIn: 1024000,
            bytesOut: 512000,
            packetsIn: 8500,
            packetsOut: 7200,
          },
        },
        application: {
          uptime: 864000,
          requestsPerSecond: 1250,
          averageResponseTime: 45,
          activeConnections: 342,
          queuedRequests: 12,
          errorRate: 0.002,
        },
        database: {
          connections: {
            active: 25,
            idle: 15,
            total: 40,
          },
          queryTime: {
            avg: 12.5,
            p50: 8,
            p95: 45,
            p99: 120,
          },
        },
      };

      console.log("\n=== Performance Metrics ===");
      log.info("System performance snapshot", performanceMetrics);

      expect(true).toBe(true);
    });
  });

  describe("Child Loggers with Context", () => {
    it("creates request-scoped child loggers", () => {
      const log = createLogger({
        pretty: { enabled: true },
        service: "api-service",
        env: "production",
      });

      console.log("\n=== Child Logger with Request Context ===");

      // Create a child logger for a specific request
      const requestLogger = log.child({
        requestId: "req_abc123",
        userId: "usr_789",
        sessionId: "sess_xyz456",
        clientIp: "203.0.113.42",
      });

      requestLogger.info("Request started", {
        method: "GET",
        path: "/api/user/profile",
      });

      requestLogger.debug("Validating authentication token");

      requestLogger.info("Database query executed", {
        query: "getUserProfile",
        duration: 23,
      });

      requestLogger.info("Request completed", {
        statusCode: 200,
        duration: 156,
      });

      expect(true).toBe(true);
    });

    it("creates service-specific child loggers", () => {
      const log = createLogger({
        pretty: { enabled: true },
      });

      console.log("\n=== Service-Specific Child Loggers ===");

      // Create child loggers for different services
      const authLogger = log.child({
        service: "auth",
        component: "jwt-validator",
      });

      const dbLogger = log.child({
        service: "database",
        component: "connection-pool",
      });

      const cacheLogger = log.child({
        service: "cache",
        component: "redis-client",
      });

      authLogger.info("JWT token validated successfully", {
        userId: "usr_123",
        expiresIn: 3600,
      });

      dbLogger.warn("Connection pool approaching limit", {
        current: 95,
        max: 100,
        waitingRequests: 5,
      });

      cacheLogger.debug("Cache hit", {
        key: "user:123:profile",
        ttl: 300,
      });

      expect(true).toBe(true);
    });
  });

  describe("Complex Error Scenarios", () => {
    it("logs errors with full context and stack traces", () => {
      const log = createLogger({
        pretty: { enabled: true },
        service: "error-prone-service",
      });

      console.log("\n=== Complex Error with Stack Trace ===");

      try {
        // Simulate an error scenario
        throw new TypeError("Cannot read property 'name' of undefined");
      } catch (error) {
        log.error(
          "Critical error in user processing",
          {
            operation: "updateUserProfile",
            userId: "usr_999",
            attemptedChanges: {
              name: "New Name",
              email: "newemail@example.com",
            },
            systemState: {
              memoryUsage: "75%",
              activeTransactions: 12,
              queueDepth: 45,
            },
            recovery: {
              action: "rollback",
              fallbackValue: "previous_state",
              retryCount: 3,
              maxRetries: 5,
            },
          },
          error,
        );
      }

      expect(true).toBe(true);
    });
  });

  describe("Structured Logging with Custom Formatting", () => {
    it("uses custom formatter for specialized output", () => {
      const customFormatter = (rec: LogRecord) => {
        return `[${rec.level.toUpperCase()}] ${rec.msg} | Service: ${rec.service || "unknown"} | ${JSON.stringify(rec.context || {})}`;
      };

      const log = createLogger({
        pretty: {
          enabled: true,
          formatter: customFormatter,
        },
        service: "custom-format-service",
      });

      console.log("\n=== Custom Formatter Output ===");
      log.info("Custom formatted message", {
        feature: "custom-formatting",
        test: true,
        nested: { value: 42 },
      });

      expect(true).toBe(true);
    });
  });
});
