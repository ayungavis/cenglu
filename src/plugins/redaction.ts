import { Redactor } from "../redaction";
import type { ErrorInfo, LoggerPlugin, LogRecord, RedactionOptions } from "../types";

export interface RedactionPluginOptions extends RedactionOptions {
  redactMessage?: boolean;
  redactContext?: boolean;
  redactError?: boolean;
  onRedact?: (record: LogRecord, redactedFields: string[]) => void;
}

/**
 * Plugin that redacts sensitive data from logs
 *
 * This plugin automatically removes or masks sensitive information
 * like passwords, tokens, credit card numbers, etc.
 *
 * @example
 * const logger = createLogger({
 *   plugins: [
 *     redactionPlugin({
 *       useDefaults: true, // Use built-in patterns
 *       paths: ["customSecret", "apiKey"], // Additional paths to redact
 *       patterns: [
 *         { name: "custom", pattern: /secret-\d+/g, replacement: "[SECRET]" }
 *       ],
 *     }),
 *   ],
 * });
 *
 * logger.info("Login", { password: "secret123" });
 * // Output: Login { password: "[REDACTED]" }
 */
export function redactionPlugin(options: RedactionPluginOptions = {}): LoggerPlugin {
  const {
    redactMessage = true,
    redactContext = true,
    redactError = true,
    onRedact,
    ...redactorOptions
  } = options;

  const redactor = new Redactor(redactorOptions);

  return {
    name: "redaction",
    order: 10, // Run early but after sampling

    onRecord(record: LogRecord): LogRecord {
      const redactedFields: string[] = [];
      const result = { ...record };

      // Redact message
      if (redactMessage && record.msg) {
        const redactedMsg = redactor.redactString(record.msg);
        if (redactedMsg !== record.msg) {
          result.msg = redactedMsg;
          redactedFields.push("msg");
        }
      }

      // Redact context
      if (redactContext && record.context) {
        const redactedContext = redactor.redactObject(record.context);
        // Check if anything was actually redacted
        if (JSON.stringify(redactedContext) !== JSON.stringify(record.context)) {
          result.context = redactedContext;
          redactedFields.push("context");
        }
      }

      // Redact error
      if (redactError && record.err) {
        const redactedErr = redactor.redactObject(record.err) as ErrorInfo;
        if (JSON.stringify(redactedErr) !== JSON.stringify(record.err)) {
          result.err = redactedErr;
          redactedFields.push("err");
        }
      }

      // Callback if anything was redacted
      if (redactedFields.length > 0) {
        onRedact?.(result, redactedFields);
      }

      return result;
    },
  };
}

/**
 * Create a strict redaction plugin that fails closed
 *
 * If redaction fails for any reason, the log is dropped entirely.
 * This is useful for high-security environments.
 */
export function strictRedactionPlugin(options: RedactionPluginOptions = {}): LoggerPlugin {
  const innerPlugin = redactionPlugin(options);

  return {
    name: "strict-redaction",
    order: innerPlugin.order,

    onRecord(record: LogRecord): LogRecord | null {
      try {
        if (typeof innerPlugin.onRecord !== "function") {
          return record;
        }

        return innerPlugin.onRecord(record);
      } catch (err) {
        // If redaction fails, drop the log entirely
        process.stderr.write(
          `[cenglu:strict-redaction] Dropping log due to redaction error: ${err}\n`
        );
        return null;
      }
    },
  };
}
