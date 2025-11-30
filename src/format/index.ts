import type { FormatterType, LogRecord, Theme, TreeOptions } from "../types";
import { formatDatadog } from "./datadog";
import { formatEcs } from "./ecs";
import { formatJson } from "./json";
import { formatLogfmt } from "./logfmt";
import { formatPretty } from "./pretty";
import { formatSplunk } from "./splunk";

/**
 * Get a formatter function by type
 */
export function getFormatter(
  type: FormatterType,
  options?: {
    theme?: Partial<Theme>;
    treeOptions?: TreeOptions;
    splunkOptions?: { host?: string; source?: string; index?: string };
  }
): (record: LogRecord) => string {
  switch (type) {
    case "json":
      return formatJson;
    case "pretty":
      return (record) => formatPretty(record, options?.theme, options?.treeOptions);
    case "ecs":
      return formatEcs;
    case "datadog":
      return formatDatadog;
    case "splunk":
      return (record) => formatSplunk(record, options?.splunkOptions);
    case "logfmt":
      return formatLogfmt;
    default:
      return formatJson;
  }
}

// biome-ignore lint/performance/noBarrelFile: organized exports
export * from "./colorize";
export * from "./datadog";
export * from "./datetime";
export * from "./ecs";
export * from "./json";
export * from "./logfmt";
export * from "./pretty";
export * from "./splunk";
