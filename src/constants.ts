import { colorize } from "./format/colorize";
import type { LogLevel, RedactionPattern, Theme, TreeOptions } from "./types";

export const LEVEL_VALUES: Readonly<Record<LogLevel, number>> = Object.freeze({
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
});

export const LEVELS: readonly LogLevel[] = Object.freeze([
  "trace",
  "debug",
  "info",
  "warn",
  "error",
  "fatal",
]);

export const ANSI = {
  reset: "\u001b[0m",
  bold: "\u001b[1m",
  dim: "\u001b[2m",
  italic: "\u001b[3m",
  underline: "\u001b[4m",

  // Foreground colors
  black: "\u001b[30m",
  red: "\u001b[31m",
  green: "\u001b[32m",
  yellow: "\u001b[33m",
  blue: "\u001b[34m",
  magenta: "\u001b[35m",
  cyan: "\u001b[36m",
  white: "\u001b[37m",
  gray: "\u001b[90m",

  // Bright foreground colors
  brightRed: "\u001b[91m",
  brightGreen: "\u001b[92m",
  brightYellow: "\u001b[93m",
  brightBlue: "\u001b[94m",
  brightMagenta: "\u001b[95m",
  brightCyan: "\u001b[96m",
  brightWhite: "\u001b[97m",
} as const;

export const DEFAULT_THEME: Theme = {
  dim: colorize(ANSI.dim),
  gray: colorize(ANSI.gray),
  red: colorize(ANSI.red),
  yellow: colorize(ANSI.yellow),
  green: colorize(ANSI.green),
  cyan: colorize(ANSI.cyan),
  magenta: colorize(ANSI.magenta),
  bold: colorize(ANSI.bold),
};

export const NO_COLOR_THEME: Theme = {
  dim: (s) => s,
  gray: (s) => s,
  red: (s) => s,
  yellow: (s) => s,
  green: (s) => s,
  cyan: (s) => s,
  magenta: (s) => s,
  bold: (s) => s,
};

export const LEVEL_COLORS: Record<string, keyof Theme> = {
  trace: "gray",
  debug: "cyan",
  info: "green",
  warn: "yellow",
  error: "red",
  fatal: "red",
};

export const DEFAULT_TREE_OPTIONS: Required<TreeOptions> = {
  maxDepth: 10,
  maxArrayLength: 100,
  maxStringLength: 1000,
};

export const DEFAULT_PATTERNS: RedactionPattern[] = [
  // Credit Card Numbers (Visa, MasterCard, Amex, etc.)
  {
    name: "credit_card",
    pattern: /\b(?:\d{4}[- ]?){3}\d{4}\b/g,
    replacement: "[REDACTED_CARD]",
  },

  // Credit Card with spaces/dashes
  {
    name: "credit_card_formatted",
    pattern: /\b\d{4}[- ]\d{4}[- ]\d{4}[- ]\d{4}\b/g,
    replacement: "[REDACTED_CARD]",
  },

  // Social Security Numbers (US)
  {
    name: "ssn",
    pattern: /\b\d{3}-\d{2}-\d{4}\b/g,
    replacement: "[REDACTED_SSN]",
  },

  // SSN without dashes
  {
    name: "ssn_plain",
    pattern: /\b(?!000|666|9\d{2})\d{3}(?!00)\d{2}(?!0000)\d{4}\b/g,
    replacement: "[REDACTED_SSN]",
  },

  // Email Addresses
  {
    name: "email",
    pattern: /\b[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Z|a-z]{2,}\b/gi,
    replacement: "[REDACTED_EMAIL]",
  },

  // JWT Tokens
  {
    name: "jwt",
    pattern: /\beyJ[A-Za-z0-9_-]*\.eyJ[A-Za-z0-9_-]*\.[A-Za-z0-9_-]*\b/g,
    replacement: "[REDACTED_JWT]",
  },

  // Bearer Tokens
  {
    name: "bearer_token",
    pattern: /\bBearer\s+[A-Za-z0-9\-._~+/]+=*\b/gi,
    replacement: "Bearer [REDACTED]",
  },

  // Basic Auth Header
  {
    name: "basic_auth",
    pattern: /\bBasic\s+[A-Za-z0-9+/]+=*\b/gi,
    replacement: "Basic [REDACTED]",
  },

  // API Keys (common formats)
  {
    name: "api_key_param",
    pattern: /(?:api[_-]?key|apikey|api_secret|api_token)["\s]*[:=]["\s]*["']?([^"'\s,}{]+)["']?/gi,
    replacement: "api_key=[REDACTED]",
  },

  // AWS Access Key ID
  {
    name: "aws_access_key",
    pattern: /\b(?:AKIA|A3T|AGPA|AIDA|AROA|AIPA|ANPA|ANVA|ASIA)[A-Z0-9]{16}\b/g,
    replacement: "[REDACTED_AWS_KEY]",
  },

  // AWS Secret Key (40 character base64)
  {
    name: "aws_secret_key",
    pattern:
      /\b(?:aws_secret_access_key|aws_secret_key)["\s]*[:=]["\s]*["']?([A-Za-z0-9/+=]{40})["']?/gi,
    replacement: "aws_secret_key=[REDACTED]",
  },

  // Private Keys
  {
    name: "private_key",
    pattern:
      /-----BEGIN (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----[\s\S]*?-----END (?:RSA |EC |DSA |OPENSSH )?PRIVATE KEY-----/g,
    replacement: "[REDACTED_PRIVATE_KEY]",
  },

  // Password in JSON/URL/Config
  {
    name: "password_field",
    pattern: /(?:password|passwd|pwd|secret)["\s]*[:=]["\s]*["']?([^"'\s,}{]+)["']?/gi,
    replacement: 'password="[REDACTED]"',
  },

  // Connection Strings with passwords
  {
    name: "connection_string",
    pattern: /:\/\/[^:]+:([^@]+)@/g,
    replacement: "://[user]:[REDACTED]@",
  },

  // IP Addresses (optional - some may want to keep these)
  {
    name: "ipv4",
    pattern:
      /\b(?:(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\.){3}(?:25[0-5]|2[0-4][0-9]|[01]?[0-9][0-9]?)\b/g,
    replacement: "[REDACTED_IP]",
  },

  // Phone Numbers (various formats)
  {
    name: "phone",
    pattern: /\b(?:\+?1[-.\s]?)?(?:\(?[0-9]{3}\)?[-.\s]?)?[0-9]{3}[-.\s]?[0-9]{4}\b/g,
    replacement: "[REDACTED_PHONE]",
  },

  // GitHub/GitLab Personal Access Tokens
  {
    name: "github_token",
    pattern: /\b(?:ghp|gho|ghu|ghs|ghr)_[A-Za-z0-9]{36,}\b/g,
    replacement: "[REDACTED_GITHUB_TOKEN]",
  },

  // Slack Tokens
  {
    name: "slack_token",
    pattern: /\bxox[baprs]-[0-9]+-[0-9]+-[A-Za-z0-9]+\b/g,
    replacement: "[REDACTED_SLACK_TOKEN]",
  },

  // Google API Key
  {
    name: "google_api_key",
    pattern: /\bAIza[0-9A-Za-z_-]{35}\b/g,
    replacement: "[REDACTED_GOOGLE_KEY]",
  },

  // Stripe API Keys
  {
    name: "stripe_key",
    pattern: /\b(?:sk|pk)_(?:live|test)_[A-Za-z0-9]{24,}\b/g,
    replacement: "[REDACTED_STRIPE_KEY]",
  },
];

export const DEFAULT_SENSITIVE_PATHS: readonly string[] = Object.freeze([
  // Passwords
  "password",
  "passwd",
  "pwd",
  "pass",
  "secret",
  "credential",
  "credentials",

  // Tokens
  "token",
  "accesstoken",
  "access_token",
  "refreshtoken",
  "refresh_token",
  "idtoken",
  "id_token",
  "authtoken",
  "auth_token",
  "bearertoken",
  "bearer_token",
  "sessiontoken",
  "session_token",

  // API Keys
  "apikey",
  "api_key",
  "apikeys",
  "api_keys",
  "apisecret",
  "api_secret",

  // Auth
  "authorization",
  "auth",
  "authentication",

  // Crypto
  "privatekey",
  "private_key",
  "secretkey",
  "secret_key",
  "encryptionkey",
  "encryption_key",
  "signingkey",
  "signing_key",

  // Personal Data
  "ssn",
  "socialsecurity",
  "social_security",
  "socialsecuritynumber",
  "social_security_number",

  // Financial
  "creditcard",
  "credit_card",
  "cardnumber",
  "card_number",
  "cvv",
  "cvc",
  "pin",
  "accountnumber",
  "account_number",
  "routingnumber",
  "routing_number",

  // Client Secrets
  "clientsecret",
  "client_secret",
  "consumersecret",
  "consumer_secret",

  // Database
  "connectionstring",
  "connection_string",
  "dbpassword",
  "db_password",
  "databasepassword",
  "database_password",
]);
