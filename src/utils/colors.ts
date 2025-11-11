export type ColorTheme = {
  trace: string;
  debug: string;
  info: string;
  warn: string;
  error: string;
  fatal: string;
  timestamp: string;
  key: string;
  string: string;
  number: string;
  boolean: string;
  null: string;
  undefined: string;
  array: string;
  reset: string;
};

export const defaultTheme: ColorTheme = {
  trace: "\x1b[90m", // gray
  debug: "\x1b[36m", // cyan
  info: "\x1b[32m", // green
  warn: "\x1b[33m", // yellow
  error: "\x1b[31m", // red
  fatal: "\x1b[35m", // magenta
  timestamp: "\x1b[90m", // gray
  key: "\x1b[94m", // bright blue
  string: "\x1b[32m", // green
  number: "\x1b[96m", // bright cyan
  boolean: "\x1b[33m", // yellow
  null: "\x1b[90m", // gray
  undefined: "\x1b[90m", // gray
  array: "\x1b[95m", // bright magenta
  reset: "\x1b[0m",
};

export const noColorTheme: ColorTheme = {
  trace: "",
  debug: "",
  info: "",
  warn: "",
  error: "",
  fatal: "",
  timestamp: "",
  key: "",
  string: "",
  number: "",
  boolean: "",
  null: "",
  undefined: "",
  array: "",
  reset: "",
};

export function stripAnsi(str: string): string {
  // biome-ignore lint/suspicious/noControlCharactersInRegex: intentional for ANSI codes
  return str.replace(/\x1b\[[0-9;]*m/g, "");
}

export function colorize(text: string, color: string, theme: ColorTheme): string {
  if (!color) {
    return text;
  }
  return `${color}${text}${theme.reset}`;
}
