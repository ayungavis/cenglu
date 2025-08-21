import type { Logger } from "../logger";
import type { LogRecord, ProviderAdapter } from "../types";

/**
 * OpenTelemetry integration for the logger
 * This provides observability integration with OpenTelemetry
 */

export interface OpenTelemetryOptions {
  serviceName?: string;
  serviceVersion?: string;
  serviceNamespace?: string;
  deploymentEnvironment?: string;
  resourceAttributes?: Record<string, string | number | boolean>;
  exporters?: {
    console?: boolean;
    otlp?: {
      endpoint?: string;
      headers?: Record<string, string>;
      protocol?: "grpc" | "http";
    };
    jaeger?: {
      endpoint?: string;
    };
    zipkin?: {
      endpoint?: string;
    };
  };
  propagators?: Array<
    "tracecontext" | "baggage" | "b3" | "b3multi" | "jaeger" | "xray"
  >;
  samplingRate?: number;
}

/**
 * OpenTelemetry adapter for sending logs to OpenTelemetry collectors
 */
export class OpenTelemetryAdapter implements ProviderAdapter {
  name = "opentelemetry";
  private options: OpenTelemetryOptions;
  private loggerProvider: any; // Would be LoggerProvider from @opentelemetry/sdk-logs
  private logger: any; // Would be Logger from @opentelemetry/api-logs

  constructor(options: OpenTelemetryOptions = {}) {
    this.options = {
      serviceName:
        options.serviceName ||
        process.env.OTEL_SERVICE_NAME ||
        "unknown-service",
      serviceVersion:
        options.serviceVersion || process.env.OTEL_SERVICE_VERSION || "0.0.0",
      serviceNamespace:
        options.serviceNamespace || process.env.OTEL_SERVICE_NAMESPACE,
      deploymentEnvironment:
        options.deploymentEnvironment ||
        process.env.OTEL_DEPLOYMENT_ENVIRONMENT ||
        process.env.NODE_ENV ||
        "development",
      resourceAttributes: options.resourceAttributes || {},
      exporters: options.exporters || { console: true },
      propagators: options.propagators || ["tracecontext", "baggage"],
      samplingRate: options.samplingRate ?? 1.0,
    };

    this.initializeOpenTelemetry();
  }

  private initializeOpenTelemetry(): void {
    // This would initialize OpenTelemetry SDK
    // In real implementation, you'd use:
    // import { LoggerProvider } from '@opentelemetry/sdk-logs';
    // import { Resource } from '@opentelemetry/resources';
    // import { SemanticResourceAttributes } from '@opentelemetry/semantic-conventions';

    // For now, we'll create a mock implementation
    this.loggerProvider = {
      getLogger: (_name: string) => ({
        emit: (logRecord: any) => {
          // Mock emit function
          if (this.options.exporters?.console) {
            console.log("[OpenTelemetry]", JSON.stringify(logRecord));
          }
        },
      }),
    };

    this.logger = this.loggerProvider.getLogger(this.options.serviceName);
  }

  async handle(record: LogRecord): Promise<void> {
    // Sample based on configured rate
    if (Math.random() > (this.options.samplingRate ?? 1.0)) {
      return;
    }

    // Convert our LogRecord to OpenTelemetry format
    const otelRecord = this.convertToOtelFormat(record);

    // Emit the log record
    this.logger.emit(otelRecord);
  }

  private convertToOtelFormat(record: LogRecord): any {
    // Map log levels to OpenTelemetry severity
    const severityMap: Record<string, number> = {
      trace: 1, // TRACE
      debug: 5, // DEBUG
      info: 9, // INFO
      warn: 13, // WARN
      error: 17, // ERROR
      fatal: 21, // FATAL
    };

    return {
      timestamp: record.time,
      severityNumber: severityMap[record.level] || 0,
      severityText: record.level.toUpperCase(),
      body: record.msg,
      attributes: {
        ...this.options.resourceAttributes,
        "service.name": record.service || this.options.serviceName,
        "service.version": record.version || this.options.serviceVersion,
        "service.namespace": this.options.serviceNamespace,
        "deployment.environment":
          record.env || this.options.deploymentEnvironment,
        "trace.id": record.traceId,
        "span.id": record.spanId,
        ...(record.context || {}),
        ...(record.err
          ? {
              "exception.type": record.err.name,
              "exception.message": record.err.message,
              "exception.stacktrace": record.err.stack,
            }
          : {}),
      },
      resource: {
        "service.name": record.service || this.options.serviceName,
        "service.version": record.version || this.options.serviceVersion,
        "service.namespace": this.options.serviceNamespace,
        "deployment.environment":
          record.env || this.options.deploymentEnvironment,
      },
    };
  }

  /**
   * Get current trace context from OpenTelemetry
   */
  static getTraceContext(): { traceId?: string; spanId?: string } | undefined {
    // This would use OpenTelemetry API to get current trace context
    // import { trace } from '@opentelemetry/api';
    // const span = trace.getActiveSpan();
    // if (span) {
    //   const spanContext = span.spanContext();
    //   return {
    //     traceId: spanContext.traceId,
    //     spanId: spanContext.spanId,
    //   };
    // }

    // Mock implementation
    return undefined;
  }
}

/**
 * Create a trace provider function that extracts trace context from OpenTelemetry
 */
export function createOtelTraceProvider(): () =>
  | { traceId?: string; spanId?: string }
  | undefined {
  return () => OpenTelemetryAdapter.getTraceContext();
}

/**
 * Express middleware to extract OpenTelemetry context
 */
export function otelExpressMiddleware() {
  return (req: any, _res: any, next: any) => {
    // Extract trace context from headers
    const traceParent = req.headers.traceparent;
    const _traceState = req.headers.tracestate;

    if (traceParent) {
      // Parse W3C Trace Context format
      const parts = traceParent.split("-");
      if (parts.length === 4) {
        req.traceId = parts[1];
        req.spanId = parts[2];
      }
    }

    // Extract baggage
    const baggage = req.headers.baggage;
    if (baggage) {
      req.baggage = parseBaggage(baggage);
    }

    next();
  };
}

/**
 * Parse W3C Baggage header
 */
function parseBaggage(baggageHeader: string): Record<string, string> {
  const baggage: Record<string, string> = {};
  const pairs = baggageHeader.split(",");

  for (const pair of pairs) {
    const [key, value] = pair.trim().split("=");
    if (key && value) {
      baggage[key] = decodeURIComponent(value);
    }
  }

  return baggage;
}

/**
 * Create OpenTelemetry adapter with configuration
 */
export function createOpenTelemetryAdapter(
  options?: OpenTelemetryOptions,
): OpenTelemetryAdapter {
  return new OpenTelemetryAdapter(options);
}

/**
 * Helper to configure logger with OpenTelemetry
 */
export function configureLoggerWithOtel(
  logger: Logger,
  options?: OpenTelemetryOptions,
): Logger {
  const _adapter = createOpenTelemetryAdapter(options);

  // This would add the adapter to the logger
  // In real implementation, we'd need to modify Logger class to accept adapters after construction
  // or use the adapters option during construction

  return logger;
}

/**
 * Structured logging helpers for OpenTelemetry
 */
export const OtelHelpers = {
  /**
   * Create a log record with OpenTelemetry attributes
   */
  createLogAttributes(attrs: {
    operation?: string;
    userId?: string;
    requestId?: string;
    httpMethod?: string;
    httpUrl?: string;
    httpStatusCode?: number;
    httpUserAgent?: string;
    dbSystem?: string;
    dbStatement?: string;
    messagingSystem?: string;
    messagingOperation?: string;
    [key: string]: unknown;
  }): Record<string, unknown> {
    const otelAttrs: Record<string, unknown> = {};

    // Map common attributes to OpenTelemetry semantic conventions
    if (attrs.operation) otelAttrs["code.function"] = attrs.operation;
    if (attrs.userId) otelAttrs["enduser.id"] = attrs.userId;
    if (attrs.requestId) otelAttrs["http.request.id"] = attrs.requestId;
    if (attrs.httpMethod) otelAttrs["http.method"] = attrs.httpMethod;
    if (attrs.httpUrl) otelAttrs["http.url"] = attrs.httpUrl;
    if (attrs.httpStatusCode)
      otelAttrs["http.status_code"] = attrs.httpStatusCode;
    if (attrs.httpUserAgent) otelAttrs["http.user_agent"] = attrs.httpUserAgent;
    if (attrs.dbSystem) otelAttrs["db.system"] = attrs.dbSystem;
    if (attrs.dbStatement) otelAttrs["db.statement"] = attrs.dbStatement;
    if (attrs.messagingSystem)
      otelAttrs["messaging.system"] = attrs.messagingSystem;
    if (attrs.messagingOperation)
      otelAttrs["messaging.operation"] = attrs.messagingOperation;

    // Add custom attributes
    for (const [key, value] of Object.entries(attrs)) {
      if (!otelAttrs[key]) {
        otelAttrs[key] = value;
      }
    }

    return otelAttrs;
  },

  /**
   * Create span events for logging
   */
  createSpanEvent(name: string, attributes?: Record<string, unknown>) {
    return {
      name,
      timestamp: Date.now(),
      attributes: attributes || {},
    };
  },
};
