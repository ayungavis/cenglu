import type { Formatter, LogLevel } from "../core/types";

export type ConsoleTransportConfig = {
  level?: LogLevel;
  formatter?: Formatter;
  pretty?: boolean;
};
