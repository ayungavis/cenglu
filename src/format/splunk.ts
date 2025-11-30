import type { ErrorInfo, LogRecord } from "../types";
import { jsonReplacer } from "./json";

export type SplunkLogRecord = {
  time: number;
  host?: string;
  source?: string;
  sourcetype: string;
  index?: string;
  event: {
    message: string;
    level: string;
    service?: string;
    env?: string;
    version?: string;
    traceId?: string;
    spanId?: string;
    context?: Record<string, unknown>;
    error?: ErrorInfo;
  };
};

export function formatSplunk(
  record: LogRecord,
  options?: {
    host?: string;
    source?: string;
    index?: string;
  }
): string {
  const splunk: SplunkLogRecord = {
    time: Math.floor(record.time / 1000), // Splunk uses seconds
    sourcetype: "_json",
    source: options?.source ?? record.service ?? "app",
    event: {
      message: record.msg,
      level: record.level,
      service: record.service,
      env: record.env,
      version: record.version,
      traceId: record.traceId,
      spanId: record.spanId,
      context: record.context,
      error: record.err ?? undefined,
    },
  };

  if (options?.host) {
    splunk.host = options.host;
  }
  if (options?.index) {
    splunk.index = options.index;
  }

  return JSON.stringify(splunk, jsonReplacer);
}

export function toSplunkObject(
  record: LogRecord,
  options?: {
    host?: string;
    source?: string;
    index?: string;
  }
): SplunkLogRecord {
  return JSON.parse(formatSplunk(record, options));
}
