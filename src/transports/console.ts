import type { LogRecord, Transport } from "../types";

export class ConsoleTransport implements Transport {
  write(_rec: LogRecord, formatted: string, isError: boolean): void {
    (isError ? console.error : console.log)(formatted);
  }
}
