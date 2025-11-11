import { getLevelColor } from "../core/levels";
import type { Formatter } from "../core/types";
import { type ColorTheme, defaultTheme, noColorTheme } from "../utils/colors";

export type PrettyFormatterConfig = {
  colorize?: boolean;
  showTimestamp?: boolean;
  showLevel?: boolean;
  showService?: boolean;
  timestampFormat?: "iso" | "locale" | "unix" | "relative";
  indent?: number;
  maxDepth?: number;
  theme?: Partial<ColorTheme>;
  treeSymbols?: {
    branch: string;
    lastBranch: string;
    vertical: string;
    empty: string;
    dot: string;
  };
  truncate?: {
    strings?: number;
    arrays?: number;
    objects?: number;
  };
  hideEmpty?: boolean;
  sortKeys?: boolean;
  showHidden?: boolean;
  // biome-ignore lint/suspicious/noExplicitAny: the formaters can be different for each use case
  customFormaters?: Record<string, (value: any) => string>;
  levelDisplay?: "short" | "full" | "icon";
  levelIcons?: Record<string, string>;
  includeStackTrace?: boolean;
  strackTraceFormat?: "full" | "short" | "single";
  highlightErrors?: boolean;
};

export class PrettyFormatter implements Formatter {
  private config: Required<PrettyFormatterConfig>;
  private theme: ColorTheme;
  private lastTimestamp?: Date;

  constructor(config: PrettyFormatterConfig = {}) {
    const isColorSupported = this.supportsColor();
    const shouldColorize =
      config.colorize ?? (isColorSupported && process.env.NODE_ENV !== "production");

    this.theme = shouldColorize ? { ...defaultTheme, ...(config.theme ?? {}) } : noColorTheme;

    this.config = {
      colorize: shouldColorize,
      showTimestamp: config.showTimestamp ?? true,
      showLevel: config.showLevel ?? true,
      showService: config.showService ?? true,
      timestampFormat: config.timestampFormat ?? "iso",
      indent: config.indent ?? 2,
      maxDepth: config.maxDepth ?? 6,
      theme: config.theme ?? {},
      treeSymbols: config.treeSymbols ?? {
        branch: "├─",
        lastBranch: "└─",
        vertical: "│ ",
        empty: "  ",
        dot: "·",
      },
      truncate: config.truncate ?? {
        strings: 200,
        arrays: 10,
        objects: 20,
      },
      hideEmpty: config.hideEmpty ?? false,
      sortKeys: config.sortKeys ?? false,
      showHidden: config.showHidden ?? false,
      customFormaters: config.customFormaters ?? {},
      levelDisplay: config.levelDisplay ?? "full",
      levelIcons: config.levelIcons ?? {
        trace: "🔍",
        debug: "🐛",
        info: "ℹ️ ",
        warn: "⚠️ ",
        error: "❌",
        fatal: "💀",
      },
      includeStackTrace: config.includeStackTrace ?? true,
      strackTraceFormat: config.strackTraceFormat ?? "short",
      highlightErrors: config.highlightErrors ?? true,
    };
  }

  format(context: LogContext): string {
    const parts: string[] = [];

    // Header line
    const header = this.formatHeader(context);
    if (header) {
      parts.push(header);
    }

    // Main message with tree branch
    const message = this.formatMessage(context.message, context.level);
    parts.push(message);

    // Format metadata as tree
    const metadataTree = this.formatMetadataTree(context);
    if (metadataTree) {
      parts.push(metadataTree);
    }

    // Format error if present
    if (context.error) {
      const errorOutput = this.formatError(context.error);
      parts.push(errorOutput);
    }

    return parts.join("\n");
  }

  private formatHeader(context: LogContext): string {
    const parts: string[] = [];

    // Timestamp
    if (this.config.showTimestamp) {
      const timestamp = this.formatTimestamp(context.timestamp);
      parts.push(this.colorize(timestamp, this.theme.timestamp));
    }

    // Level
    if (this.config.showLevel) {
      const level = this.formatLevel(context.level);
      const levelColor = getLevelColor(context.level);
      parts.push(this.colorize(level, levelColor));
    }

    // Service name
    if (this.config.showService && context.service) {
      const service = `[${context.service}]`;
      parts.push(this.colorize(service, this.theme.info));
    }

    // Correlation ID
    if (context.correlationId) {
      const correlationId = `[${context.correlationId.substring(0, 8)}]`;
      parts.push(this.colorize(correlationId, this.theme.debug));
    }

    return parts.length > 0 ? parts.join(" ") : "";
  }

  private formatMessage(message: string, level: string): string {
    const { branch } = this.config.treeSymbols;
    const isError = level === "error" || level === "fatal";
    const messageColor = isError && this.config.highlightErrors ? this.theme.error : "\x1b[1m"; // bold

    return `${branch} ${this.colorize(message, messageColor)}`;
  }

  private formatMetadataTree(context: LogContext): string {
    const metadata: Record<string, unknown> = {};

    // Collect all metadata
    if (context.metadata) {
      Object.assign(metadata, context.metadata);
    }

    // Add context properties that aren't standard fields
    const standardFields = [
      "timestamp",
      "level",
      "message",
      "service",
      "environment",
      "error",
      "metadata",
      "correlationId",
    ];
    for (const key in Object.keys(context)) {
      if (!standardFields.includes(key) && context[key] !== undefined) {
        metadata[key] = context[key];
      }
    }

    // Skip if empty and configured to hide
    if (Object.keys(metadata).length === 0 && this.config.hideEmpty) {
      return "";
    }

    return this.formatObject(metadata, 0);
  }

  private formatObject(obj: Record<string, unknown>, depth: number): string {
    if (depth > this.config.maxDepth) {
      return this.colorize("[Max Depth Reached]", this.theme.null);
    }

    const entries = Object.entries(obj);
    if (entries.length === 0) {
      return "";
    }

    // Sort keys if configured
    if (this.config.sortKeys) {
      entries.sort(([a], [b]) => a.localeCompare(b));
    }

    const lines: string[] = [];
    const { branch, lastBranch, vertical, empty } = this.config.treeSymbols;

    entries.forEach(([key, value], index) => {
      const isLast = index === entries.length - 1;
      const prefix = depth === 0 ? (isLast ? lastBranch : branch) : empty;
      const keyFormatted = this.colorize(key, this.theme.key);

      // Check for custom formatter
      if (this.config.customFormaters[key]) {
        const formatted = this.config.customFormaters[key](value);
        lines.push(`${prefix} ${keyFormatted}: ${formatted}`);
        return;
      }

      if (value === null || value === undefined) {
        const valueStr = this.colorize(String(value), this.theme.null);
        lines.push(`${prefix} ${keyFormatted}: ${valueStr}`);
      } else if (value instanceof Error) {
        lines.push(`${prefix} ${keyFormatted}: ${this.formatInlineError(value)}`);
      } else if (value instanceof Date) {
        const dateStr = this.colorize(value.toISOString(), this.theme.string);
        lines.push(`${prefix} ${keyFormatted}: ${dateStr}`);
      } else if (typeof value === "object" && !Array.isArray(value)) {
        const objEntries = Object.entries(value);
        if (objEntries.length === 0 && this.config.hideEmpty) {
          return;
        }

        if (objEntries.length > (this.config.truncate.objects ?? 20)) {
          lines.push(
            `${prefix} ${keyFormatted}: ${this.colorize(`[Object with ${objEntries.length} keys]`, this.theme.array)}`
          );
        } else {
          lines.push(`${prefix} ${keyformatted}:`);
          const nestedLines = this.formatNestedObject(value, depth + 1, isLast);
          lines.push(...nestedLines);
        }
      } else if (Array.isArray(value)) {
        lines.push(`${prefix} ${keyFormatted}: ${this.formatArray(value, depth)}`);
      } else {
        const valueStr = this.formatValue(value);
        lines.push(`${prefix} ${keyFormatted}: ${valueStr}`);
      }
    });

    return lines.join("\n");
  }

  private formatNestedObject(
    obj: Record<string, unknown>,
    depth: number,
    parentIsLast: boolean
  ): string[] {
    if (depth > this.config.maxDepth) {
      return [`${this.getIndent(depth)}${this.colorize("[Max Depth]", this.theme.null)}`];
    }

    const entries = Object.entries(obj);
  }
}
