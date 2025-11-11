import type { LogLevel } from "./types";

export const LOG_LEVELS: Record<LogLevel, number> = {
  trace: 10,
  debug: 20,
  info: 30,
  warn: 40,
  error: 50,
  fatal: 60,
};

export function shouldLog(currentLevel: LogLevel, configuredLevel: LogLevel): boolean {
  return LOG_LEVELS[currentLevel] >= LOG_LEVELS[configuredLevel];
}

export function getLevelColor(level: LogLevel): string {
  const colors: Record<LogLevel, string> = {
    trace: "\x1b[90m", // gray
    debug: "\x1b[36m", // cyan
    info: "\x1b[32m", // green
    warn: "\x1b[33m", // yellow
    error: "\x1b[31m", // red
    fatal: "\x1b[35m", // magenta
  };

  return colors[level] || "\x1b[0m"; // default to reset
}
