import type { RedactionOptions, RedactionPattern } from "./types";

// Built-in patterns for common sensitive data
const DEFAULT_PATTERNS: RedactionPattern[] = [
  // Credit card numbers
  {
    name: "credit_card",
    pattern: /\b(?:\d[ -]*?){13,19}\b/g,
    replacement: "[REDACTED_CARD]",
  },
  // Social Security Numbers
  {
    name: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED_SSN]",
  },
  // Email addresses
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/g,
    replacement: "[REDACTED_EMAIL]",
  },
  // JWT tokens
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9-_]+\.eyJ[A-Za-z0-9-_]+\.[A-Za-z0-9-_]+\b/g,
    replacement: "[REDACTED_JWT]",
  },
  // API Keys (common formats)
  {
    name: "api_key",
    pattern:
      /\b(?:api[_-]?key|apikey|api_secret)["\s]*[:=]["\s]*["']?([^"'\s]+)["']?\b/gi,
    replacement: "[REDACTED_API_KEY]",
  },
  // Bearer tokens
  {
    name: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*/gi,
    replacement: "Bearer [REDACTED_TOKEN]",
  },
  // Password in JSON/URLs
  {
    name: "password",
    pattern: /["']?password["']?\s*[:=]\s*["']?[^"',}\s]+["']?/gi,
    replacement: "password=[REDACTED]",
  },
  // AWS Access Key ID
  {
    name: "aws_access_key",
    pattern: /\b(?:AKIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: "[REDACTED_AWS_KEY]",
  },
  // AWS Secret Key
  {
    name: "aws_secret",
    pattern: /\b[A-Za-z0-9/+=]{40}\b/g,
    replacement: "[REDACTED_SECRET]",
  },
  // Private keys
  {
    name: "private_key",
    pattern:
      /-----BEGIN (?:RSA |EC )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC )?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },
];

// Sensitive field names to redact
const SENSITIVE_PATHS = [
  "password",
  "passwd",
  "pwd",
  "secret",
  "token",
  "apiKey",
  "api_key",
  "access_token",
  "refresh_token",
  "private_key",
  "client_secret",
  "authorization",
  "auth",
  "credentials",
  "ssn",
  "social_security_number",
  "credit_card",
  "card_number",
  "cvv",
  "pin",
];

export class Redactor {
  private patterns: RedactionPattern[];
  private paths: Set<string>;
  private customRedactor?: (value: unknown, key?: string) => unknown;

  constructor(options: RedactionOptions = {}) {
    this.patterns = options.patterns || [];

    if (options.defaultPatterns !== false) {
      this.patterns = [...DEFAULT_PATTERNS, ...this.patterns];
    }

    this.paths = new Set(
      options.paths ||
        (options.defaultPatterns !== false ? SENSITIVE_PATHS : []),
    );

    this.customRedactor = options.customRedactor;
  }

  /**
   * Redact sensitive data from a value
   */
  redact(value: unknown, key?: string): unknown {
    // Check custom redactor first
    if (this.customRedactor) {
      const customResult = this.customRedactor(value, key);
      if (customResult !== value) {
        return customResult;
      }
    }

    // Check if key is in sensitive paths
    if (key && this.shouldRedactPath(key)) {
      return "[REDACTED]";
    }

    // Handle different types
    if (typeof value === "string") {
      return this.redactString(value);
    }

    if (Array.isArray(value)) {
      return value.map((item, index) =>
        this.redact(item, key ? `${key}[${index}]` : undefined),
      );
    }

    if (value && typeof value === "object") {
      return this.redactObject(value as Record<string, unknown>);
    }

    return value;
  }

  /**
   * Redact sensitive data from a string
   */
  private redactString(str: string): string {
    let result = str;

    for (const pattern of this.patterns) {
      result = result.replace(
        pattern.pattern,
        pattern.replacement || "[REDACTED]",
      );
    }

    return result;
  }

  /**
   * Redact sensitive data from an object
   */
  private redactObject(obj: Record<string, unknown>): Record<string, unknown> {
    const result: Record<string, unknown> = {};

    for (const [key, value] of Object.entries(obj)) {
      // Skip functions and undefined
      if (typeof value === "function" || value === undefined) {
        result[key] = value;
        continue;
      }

      result[key] = this.redact(value, key);
    }

    return result;
  }

  /**
   * Check if a path should be redacted
   */
  private shouldRedactPath(path: string): boolean {
    const lowercasePath = path.toLowerCase();

    // Direct match
    if (this.paths.has(lowercasePath)) {
      return true;
    }

    // Check for partial matches (e.g., "userPassword" contains "password")
    const pathsArray = Array.from(this.paths);
    for (const sensitivePath of pathsArray) {
      if (lowercasePath.includes(sensitivePath.toLowerCase())) {
        return true;
      }
    }

    return false;
  }

  /**
   * Add a custom pattern
   */
  addPattern(pattern: RedactionPattern): void {
    this.patterns.push(pattern);
  }

  /**
   * Add a sensitive path
   */
  addPath(path: string): void {
    this.paths.add(path.toLowerCase());
  }

  /**
   * Remove a sensitive path
   */
  removePath(path: string): void {
    this.paths.delete(path.toLowerCase());
  }

  /**
   * Get statistics about redactions (useful for debugging)
   */
  getStats(): { patterns: number; paths: number } {
    return {
      patterns: this.patterns.length,
      paths: this.paths.size,
    };
  }
}

/**
 * Create a redactor with default settings
 */
export function createRedactor(options?: RedactionOptions): Redactor {
  return new Redactor(options);
}

/**
 * Quick redaction function for one-off use
 */
export function redactSensitive(
  value: unknown,
  options?: RedactionOptions,
): unknown {
  const redactor = new Redactor(options);
  return redactor.redact(value);
}
