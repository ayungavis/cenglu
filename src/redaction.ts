import { DEFAULT_PATTERNS, DEFAULT_SENSITIVE_PATHS } from "./constants";
import type { ErrorInfo, RedactionOptions, RedactionPattern } from "./types";

type RedactorConfig = {
  patterns: RedactionPattern[];
  sensitivePaths: Set<string>;
  customRedactor?: (value: unknown, key?: string) => unknown;
  maxDepth: number;
  maxStringLength: number;
  redactedPlaceholder: string;
};

/**
 * Redactor for removing sensitive data from logs
 *
 * @example
 * const redactor = new Redactor({
 *   useDefaults: true,
 *   paths: ["customSecret"],
 *   patterns: [
 *     { name: "custom", pattern: /secret-\d+/g, replacement: "[SECRET]" }
 *   ],
 * });
 *
 * const clean = redactor.redactObject({ password: "secret123" });
 * // { password: "[REDACTED]" }
 */
export class Redactor {
  private readonly config: RedactorConfig;

  constructor(options: RedactionOptions = {}) {
    const useDefaults = options.useDefaults !== false;

    // Build patterns list
    const patterns: RedactionPattern[] = [];
    if (useDefaults) {
      patterns.push(...DEFAULT_PATTERNS);
    }
    if (options.patterns) {
      patterns.push(...options.patterns);
    }

    // Build sensitive paths set (normalized to lowercase)
    const sensitivePaths = new Set<string>();
    if (useDefaults) {
      for (const path of DEFAULT_SENSITIVE_PATHS) {
        sensitivePaths.add(path.toLowerCase());
      }
    }
    if (options.paths) {
      for (const path of options.paths) {
        sensitivePaths.add(path.toLowerCase());
      }
    }

    this.config = {
      patterns,
      sensitivePaths,
      customRedactor: options.customRedactor,
      maxDepth: 20,
      maxStringLength: 100_000,
      redactedPlaceholder: "[REDACTED]",
    };
  }

  redactString(value: string): string {
    if (typeof value !== "string") {
      return String(value);
    }

    // Skip very long strings for performance
    if (value.length > this.config.maxStringLength) {
      return value;
    }

    let result = value;

    for (const { pattern, replacement = this.config.redactedPlaceholder } of this.config.patterns) {
      // Reset lastIndex for global regex patterns
      if (pattern.global) {
        pattern.lastIndex = 0;
      }

      result = result.replace(pattern, replacement);
    }

    return result;
  }

  redactObject<T extends Record<string, unknown>>(obj: T): T {
    return this.redactValue(obj, undefined, new WeakSet(), 0) as T;
  }

  redact(value: unknown, key?: string): unknown {
    return this.redactValue(value, key, new WeakSet(), 0);
  }

  isSensitivePath(key: string): boolean {
    return this.checkSensitivePath(key);
  }

  addPattern(pattern: RedactionPattern): void {
    this.config.patterns.push(pattern);
  }

  addPath(path: string): void {
    this.config.sensitivePaths.add(path.toLowerCase());
  }

  removePath(path: string): void {
    this.config.sensitivePaths.delete(path.toLowerCase());
  }

  getStats(): { patternCount: number; pathCount: number } {
    return {
      patternCount: this.config.patterns.length,
      pathCount: this.config.sensitivePaths.size,
    };
  }

  private redactValue(
    value: unknown,
    key: string | undefined,
    visited: WeakSet<object>,
    depth: number
  ): unknown {
    // Prevent infinite recursion
    if (depth > this.config.maxDepth) {
      return "[MAX_DEPTH_EXCEEDED]";
    }

    // Apply custom redactor first
    if (this.config.customRedactor) {
      const customResult = this.config.customRedactor(value, key);
      if (customResult !== value) {
        return customResult;
      }
    }

    // Check if key is sensitive
    if (key && this.checkSensitivePath(key)) {
      return this.config.redactedPlaceholder;
    }

    // Handle null/undefined
    if (value === null || value === undefined) {
      return value;
    }

    // Handle strings
    if (typeof value === "string") {
      return this.redactString(value);
    }

    // Handle primitives (no redaction needed)
    if (typeof value !== "object") {
      return value;
    }

    // Handle Date objects
    if (value instanceof Date) {
      return value;
    }

    // Handle Buffer
    if (Buffer.isBuffer(value)) {
      return value;
    }

    // Handle circular references
    if (visited.has(value)) {
      return "[CIRCULAR]";
    }
    visited.add(value);

    // Handle arrays
    if (Array.isArray(value)) {
      return this.redactArray(value, key, visited, depth);
    }

    // Handle Error objects
    if (value instanceof Error) {
      return this.redactError(value, visited, depth);
    }

    // Handle regular objects
    return this.redactPlainObject(value as Record<string, unknown>, visited, depth);
  }

  private redactArray(
    arr: unknown[],
    key: string | undefined,
    visited: WeakSet<object>,
    depth: number
  ): unknown[] {
    return arr.map((item, index) => {
      const itemKey = key ? `${key}[${index}]` : `[${index}]`;
      return this.redactValue(item, itemKey, visited, depth + 1);
    });
  }

  private redactError(error: Error, visited: WeakSet<object>, depth: number): ErrorInfo {
    const result: ErrorInfo = {
      name: error.name,
      message: this.redactString(error.message),
      stack: error.stack ? this.redactString(error.stack) : undefined,
    };

    // Handle error code
    if ("code" in error && error.code !== undefined) {
      result.code = error.code as string | number;
    }

    // Handle cause
    if ("cause" in error && error.cause !== undefined) {
      result.cause = this.redactValue(error.cause, "cause", visited, depth + 1) as ErrorInfo;
    }

    // Handle additional enumerable properties
    for (const key of Object.keys(error)) {
      if (!(key in result)) {
        const value = (error as unknown as Record<string, unknown>)[key];
        result[key] = this.redactValue(value, key, visited, depth + 1);
      }
    }

    return result;
  }

  private redactPlainObject(
    obj: Record<string, unknown>,
    visited: WeakSet<object>,
    depth: number
  ): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip functions
      if (typeof value === "function") {
        continue;
      }

      // Skip undefined values
      if (value === undefined) {
        continue;
      }

      result[key] = this.redactValue(value, key, visited, depth + 1);
    }

    return result;
  }

  private checkSensitivePath(key: string): boolean {
    const normalizedKey = key.toLowerCase();

    // Direct match
    if (this.config.sensitivePaths.has(normalizedKey)) {
      return true;
    }

    // Remove common prefixes/suffixes for matching
    const stripped = normalizedKey
      // biome-ignore lint/performance/useTopLevelRegex: intentional
      .replace(/^(the|my|user|app|config|settings?|data|info)_?/i, "")
      // biome-ignore lint/performance/useTopLevelRegex: intentional
      .replace(/_?(value|data|info|str|string|text)$/i, "");

    if (this.config.sensitivePaths.has(stripped)) {
      return true;
    }

    // Check for partial matches (e.g., "userPassword" contains "password")
    for (const sensitivePath of this.config.sensitivePaths) {
      // Check if the key contains the sensitive path
      if (normalizedKey.includes(sensitivePath)) {
        return true;
      }

      // Check camelCase (e.g., "userPassword" -> "password")
      const camelCaseMatch = normalizedKey.match(new RegExp(`[a-z]${sensitivePath}`, "i"));
      if (camelCaseMatch) {
        return true;
      }
    }

    return false;
  }
}

export function createRedactor(options?: RedactionOptions): Redactor {
  return new Redactor(options);
}

export function redact(value: unknown, options?: RedactionOptions): unknown {
  const redactor = new Redactor(options);
  return redactor.redact(value);
}

export function redactString(value: string, options?: RedactionOptions): string {
  const redactor = new Redactor(options);
  return redactor.redactString(value);
}

export function createPattern(
  nameOrPattern: string | RegExp,
  replacement?: string
): RedactionPattern {
  if (typeof nameOrPattern === "string") {
    return {
      name: nameOrPattern,
      pattern: new RegExp(escapeRegex(nameOrPattern), "gi"),
      replacement: replacement ?? "[REDACTED]",
    };
  }

  return {
    name: nameOrPattern.source.slice(0, 20),
    pattern: nameOrPattern,
    replacement: replacement ?? "[REDACTED]",
  };
}

function escapeRegex(str: string): string {
  return str.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export function mergeRedactionOptions(
  ...optionsList: (RedactionOptions | undefined)[]
): RedactionOptions {
  const merged: RedactionOptions = {
    enabled: true,
    useDefaults: true,
    patterns: [],
    paths: [],
  };

  for (const options of optionsList) {
    if (!options) {
      continue;
    }

    if (options.enabled === false) {
      merged.enabled = false;
    }

    if (options.useDefaults === false) {
      merged.useDefaults = false;
    }

    if (options.patterns) {
      merged.patterns?.push(...options.patterns);
    }

    if (options.paths) {
      merged.paths?.push(...options.paths);
    }

    if (options.customRedactor) {
      const prevRedactor = merged.customRedactor;
      if (prevRedactor) {
        // Chain redactors
        merged.customRedactor = (value, key) => {
          const result1 = prevRedactor(value, key);
          if (result1 !== value) {
            return result1;
          }
          return options.customRedactor?.(value, key);
        };
      } else {
        merged.customRedactor = options.customRedactor;
      }
    }
  }

  return merged;
}

export function createPCIRedactor(): Redactor {
  return new Redactor({
    useDefaults: false,
    patterns: [
      {
        name: "credit_card",
        pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
        replacement: "[REDACTED_PAN]",
      },
      {
        name: "cvv",
        pattern: /\b\d{3,4}\b/g,
        replacement: "[REDACTED_CVV]",
      },
    ],
    paths: [
      "cardnumber",
      "card_number",
      "pan",
      "cvv",
      "cvc",
      "cvv2",
      "cvc2",
      "expiry",
      "expiration",
      "expiry_date",
      "expiration_date",
    ],
  });
}

export function createHIPAARedactor(): Redactor {
  return new Redactor({
    useDefaults: true,
    paths: [
      "ssn",
      "social_security",
      "dob",
      "date_of_birth",
      "birthdate",
      "birth_date",
      "medical_record",
      "mrn",
      "patient_id",
      "health_plan",
      "diagnosis",
      "prescription",
      "medication",
    ],
  });
}

export function createGDPRRedactor(): Redactor {
  return new Redactor({
    useDefaults: true,
    paths: [
      "email",
      "phone",
      "address",
      "street",
      "city",
      "postal_code",
      "zip_code",
      "country",
      "first_name",
      "last_name",
      "full_name",
      "name",
      "dob",
      "date_of_birth",
      "ip_address",
      "user_agent",
      "device_id",
      "location",
      "latitude",
      "longitude",
    ],
  });
}

export function createMinimalRedactor(): Redactor {
  return new Redactor({
    useDefaults: false,
    patterns: [
      {
        name: "bearer_token",
        pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
        replacement: "Bearer [REDACTED]",
      },
      {
        name: "basic_auth",
        pattern: /\bBasic\s+[A-Za-z0-9+/]+=*\b/gi,
        replacement: "Basic [REDACTED]",
      },
    ],
    paths: ["password", "secret", "token", "api_key", "private_key"],
  });
}
