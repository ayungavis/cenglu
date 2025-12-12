import type { LogRecord } from "../types";
import { formatISOTimestamp } from "./datetime";
import { jsonReplacer } from "./json";

export type ECSLogRecord = {
  "@timestamp": string;
  message: string;
  "log.level": string;
  "log.logger"?: string;
  "service.name"?: string;
  "service.version"?: string;
  "service.environment"?: string;
  "event.dataset"?: string;
  "trace.id"?: string;
  "span.id"?: string;
  labels?: Record<string, unknown>;
  error?: {
    type?: string;
    message?: string;
    stack_trace?: string;
    code?: string | number;
  };
  [key: string]: unknown;
};

export function formatEcs(record: LogRecord): string {
  const ecs: ECSLogRecord = {
    "@timestamp": formatISOTimestamp(record.time),
    message: record.msg,
    "log.level": record.level,
  };

  // Service information
  if (record.service) {
    ecs["service.name"] = record.service;
    ecs["event.dataset"] = record.env ? `${record.service}.${record.env}` : record.service;
  }

  if (record.version) {
    ecs["service.version"] = record.version;
  }

  if (record.env) {
    ecs["service.environment"] = record.env;
  }

  // Trace context
  if (record.traceId) {
    ecs["trace.id"] = record.traceId;
  }

  if (record.spanId) {
    ecs["span.id"] = record.spanId;
  }

  // Context as labels
  if (record.context && Object.keys(record.context).length > 0) {
    ecs.labels = record.context;
  }

  // Error information
  if (record.err) {
    ecs.error = {
      type: record.err.name,
      message: record.err.message,
      stack_trace: record.err.stack,
    };

    if (record.err.code !== undefined) {
      ecs.error.code = record.err.code;
    }
  }

  return JSON.stringify(ecs, jsonReplacer);
}

export function toEcsObject(record: LogRecord): ECSLogRecord {
  return JSON.parse(formatEcs(record));
}
