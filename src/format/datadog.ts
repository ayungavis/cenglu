import type { LogRecord } from "../types";
import { jsonReplacer } from "./json";

export type DatadogLogRecord = {
  message: string;
  status: string;
  level: string;
  service?: string;
  env?: string;
  version?: string;
  timestamp: number;
  dd?: {
    trace_id?: string;
    span_id?: string;
  };
  error?: {
    kind?: string;
    message?: string;
    stack?: string;
  };
  [key: string]: unknown;
};

export function formatDatadog(record: LogRecord): string {
  const dd: DatadogLogRecord = {
    message: record.msg,
    status: record.level,
    level: record.level,
    timestamp: record.time,
  };

  // Service information
  if (record.service) {
    dd.service = record.service;
  }
  if (record.env) {
    dd.env = record.env;
  }
  if (record.version) {
    dd.version = record.version;
  }

  // Trace context
  if (record.traceId || record.spanId) {
    dd.dd = {};
    if (record.traceId) {
      dd.dd.trace_id = record.traceId;
    }
    if (record.spanId) {
      dd.dd.span_id = record.spanId;
    }
  }

  // Context (spread at top level for Datadog facets)
  if (record.context) {
    Object.assign(dd, record.context);
  }

  // Error information
  if (record.err) {
    dd.error = {
      kind: record.err.name,
      message: record.err.message,
      stack: record.err.stack,
    };
  }

  return JSON.stringify(dd, jsonReplacer);
}

export function toDatadogObject(record: LogRecord): DatadogLogRecord {
  return JSON.parse(formatDatadog(record));
}
