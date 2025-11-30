/**
 * Pad a number with leading zeros
 */
export function pad(n: number, len = 2): string {
  return String(n).padStart(len, "0");
}

/**
 * Format a timestamp as ISO-like local time
 * Format: YYYY-MM-DD HH:mm:ss.SSS
 */
export function formatTimestamp(timestamp: number): string {
  const d = new Date(timestamp);

  const year = d.getFullYear();
  const month = pad(d.getMonth() + 1);
  const day = pad(d.getDate());
  const hours = pad(d.getHours());
  const minutes = pad(d.getMinutes());
  const seconds = pad(d.getSeconds());
  const ms = pad(d.getMilliseconds(), 3);

  return `${year}-${month}-${day} ${hours}:${minutes}:${seconds}.${ms}`;
}

/**
 * Format a timestamp as ISO 8601
 */
export function formatISOTimestamp(timestamp: number): string {
  return new Date(timestamp).toISOString();
}
