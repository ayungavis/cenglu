import type { Bindings, LoggerPlugin, LogRecord } from "../types";

export type EnrichPluginOptions = {
  fields?: Bindings;
  dynamicFields?: Record<string, () => unknown>;
  compute?: (record: LogRecord) => Bindings | undefined;
  addProcessInfo?: boolean;
  addMemoryUsage?: boolean;
  addHostname?: boolean;
  hostname?: string;
  overwrite?: boolean;
};

/**
 * Plugin that enriches logs with additional context
 *
 * @example
 * const logger = createLogger({
 *   plugins: [
 *     enrichPlugin({
 *       // Static fields
 *       fields: {
 *         app: "my-app",
 *         version: "1.0.0",
 *       },
 *
 *       // Dynamic fields
 *       dynamicFields: {
 *         timestamp_iso: () => new Date().toISOString(),
 *         random_id: () => Math.random().toString(36).slice(2),
 *       },
 *
 *       // Add process info
 *       addProcessInfo: true,
 *       addHostname: true,
 *     }),
 *   ],
 * });
 */
export function enrichPlugin(options: EnrichPluginOptions = {}): LoggerPlugin {
  const {
    fields = {},
    dynamicFields = {},
    compute,
    addProcessInfo = false,
    addMemoryUsage = false,
    addHostname = false,
    hostname,
    overwrite = false,
  } = options;

  // Cache hostname
  let cachedHostname: string | undefined;

  function getHostname(): string | undefined {
    if (hostname) {
      return hostname;
    }
    if (cachedHostname) {
      return cachedHostname;
    }

    try {
      const os = require("node:os");
      cachedHostname = os.hostname();
      return cachedHostname;
    } catch {
      // biome-ignore lint/nursery/noUselessUndefined: undefined return for clarity
      return undefined;
    }
  }

  function getProcessInfo(): Bindings {
    return {
      pid: process.pid,
      node_version: process.version,
      platform: process.platform,
      arch: process.arch,
    };
  }

  function getMemoryUsage(): Bindings {
    const usage = process.memoryUsage();
    return {
      memory_rss: usage.rss,
      memory_heap_used: usage.heapUsed,
      memory_heap_total: usage.heapTotal,
      memory_external: usage.external,
    };
  }

  function mergeFields(context: Bindings | undefined, newFields: Bindings): Bindings {
    if (!context) {
      return newFields;
    }

    if (overwrite) {
      return { ...context, ...newFields };
    }

    // Don't overwrite existing fields
    const result = { ...context };
    for (const [key, value] of Object.entries(newFields)) {
      if (!(key in result)) {
        result[key] = value;
      }
    }
    return result;
  }

  return {
    name: "enrich",
    order: 20, // Run after filtering/sampling but before output

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: needed for logic
    onRecord(record: LogRecord): LogRecord {
      let enrichedContext: Bindings = record.context ? { ...record.context } : {};

      // Add static fields
      if (Object.keys(fields).length > 0) {
        enrichedContext = mergeFields(enrichedContext, fields);
      }

      // Add dynamic fields
      for (const [key, fn] of Object.entries(dynamicFields)) {
        if (overwrite || !(key in enrichedContext)) {
          try {
            enrichedContext[key] = fn();
          } catch {
            // Skip failed dynamic fields
          }
        }
      }

      // Add computed fields
      if (compute) {
        try {
          const computed = compute(record);
          if (computed) {
            enrichedContext = mergeFields(enrichedContext, computed);
          }
        } catch {
          // Skip failed compute
        }
      }

      // Add hostname
      if (addHostname) {
        const host = getHostname();
        if (host && (overwrite || !("hostname" in enrichedContext))) {
          enrichedContext.hostname = host;
        }
      }

      // Add process info
      if (addProcessInfo) {
        const info = getProcessInfo();
        enrichedContext = mergeFields(enrichedContext, info);
      }

      // Add memory usage
      if (addMemoryUsage) {
        const usage = getMemoryUsage();
        enrichedContext = mergeFields(enrichedContext, usage);
      }

      // Only update context if we added something
      if (Object.keys(enrichedContext).length > 0) {
        return { ...record, context: enrichedContext };
      }

      return record;
    },
  };
}

export function requestEnrichPlugin(options: {
  getRequestId?: () => string | undefined;
  getUserId?: () => string | undefined;
  getSessionId?: () => string | undefined;
  getTenantId?: () => string | undefined;
  customGetters?: Record<string, () => unknown>;
}): LoggerPlugin {
  const { getRequestId, getUserId, getSessionId, getTenantId, customGetters = {} } = options;

  return {
    name: "request-enrich",
    order: 25,

    // biome-ignore lint/complexity/noExcessiveCognitiveComplexity: needed for logic
    onRecord(record: LogRecord): LogRecord {
      const additions: Bindings = {};

      if (getRequestId) {
        const id = getRequestId();
        if (id) {
          additions.requestId = id;
        }
      }

      if (getUserId) {
        const id = getUserId();
        if (id) {
          additions.userId = id;
        }
      }

      if (getSessionId) {
        const id = getSessionId();
        if (id) {
          additions.sessionId = id;
        }
      }

      if (getTenantId) {
        const id = getTenantId();
        if (id) {
          additions.tenantId = id;
        }
      }

      for (const [key, getter] of Object.entries(customGetters)) {
        try {
          const value = getter();
          if (value !== undefined) {
            additions[key] = value;
          }
        } catch {
          // Skip failed getters
        }
      }

      if (Object.keys(additions).length === 0) {
        return record;
      }

      return {
        ...record,
        context: { ...record.context, ...additions },
      };
    },
  };
}

/**
 * Create a plugin that adds error fingerprinting
 *
 * Generates a unique fingerprint for each error type for grouping
 */
export function errorFingerprintPlugin(): LoggerPlugin {
  function hashString(str: string): string {
    let hash = 0;
    for (let i = 0; i < str.length; i++) {
      const char = str.charCodeAt(i);
      hash = (hash << 5) - hash + char;
      hash &= hash;
    }
    return Math.abs(hash).toString(16).slice(0, 8);
  }

  return {
    name: "error-fingerprint",
    order: 30,

    onRecord(record: LogRecord): LogRecord {
      if (!record.err) {
        return record;
      }

      // Generate fingerprint from error type and first stack line
      const parts: string[] = [record.err.name ?? "Error", record.err.message ?? ""];

      if (record.err.stack) {
        const firstStackLine = record.err.stack
          .split("\n")
          .find((line) => line.trim().startsWith("at "));
        if (firstStackLine) {
          parts.push(firstStackLine.trim());
        }
      }

      const fingerprint = hashString(parts.join(":"));

      return {
        ...record,
        context: {
          ...record.context,
          error_fingerprint: fingerprint,
        },
      };
    },
  };
}
