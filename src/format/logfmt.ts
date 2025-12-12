import type { LogRecord } from "../types";
import { formatISOTimestamp } from "./datetime";

const regex = /[\s="']/;

/**
 * Escape a value for logfmt format
 */
export function escapeLogfmtValue(value: unknown): string {
  if (value === null || value === undefined) {
    return "";
  }

  const str = typeof value === "object" ? JSON.stringify(value) : String(value);

  // Quote if contains spaces, equals, or quotes
  if (regex.test(str)) {
    return `"${str.replace(/"/g, '\\"')}"`;
  }

  return str;
}

/**
 * Format a log record in logfmt format
 * Format: time=2024-01-01T00:00:00Z level=info msg="Hello world" key=value
 */
export function formatLogfmt(record: LogRecord): string {
  const parts: string[] = [
    `time=${formatISOTimestamp(record.time)}`,
    `level=${record.level}`,
    `msg=${escapeLogfmtValue(record.msg)}`,
  ];

  if (record.service) {
    parts.push(`service=${escapeLogfmtValue(record.service)}`);
  }
  if (record.env) {
    parts.push(`env=${escapeLogfmtValue(record.env)}`);
  }
  if (record.version) {
    parts.push(`version=${escapeLogfmtValue(record.version)}`);
  }
  if (record.traceId) {
    parts.push(`trace_id=${escapeLogfmtValue(record.traceId)}`);
  }
  if (record.spanId) {
    parts.push(`span_id=${escapeLogfmtValue(record.spanId)}`);
  }

  // Add context
  if (record.context) {
    for (const [key, value] of Object.entries(record.context)) {
      parts.push(`${key}=${escapeLogfmtValue(value)}`);
    }
  }

  // Add error
  if (record.err) {
    parts.push(`error_name=${escapeLogfmtValue(record.err.name)}`);
    parts.push(`error_message=${escapeLogfmtValue(record.err.message)}`);
  }

  return parts.join(" ");
}
