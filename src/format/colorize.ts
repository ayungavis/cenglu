import { ANSI } from "../constants";

/**
 * Create a colorize function for a specific ANSI code
 */
export function colorize(code: string): (s: string) => string {
  return (s: string) => `${code}${s}${ANSI.reset}`;
}
