/**
 * Convert only the first character of the given string to lower case.
 *
 * The function returns the original string if it's empty or not provided.
 * It preserves the rest of the string exactly as-is (no trimming or other changes).
 *
 * @param text - The input string.
 * @returns The input string with the first character converted to lower case.
 *
 * @example
 * lowercaseFirstLetter('Hello') // => 'hello'
 *
 * @example
 * lowercaseFirstLetter('HELLO') // => 'hELLO'
 *
 * @example
 * // Handles empty string
 * lowercaseFirstLetter('') // => ''
 */
export const lowercaseFirstLetter = (text: string): string => {
  if (!text || text.length === 0) {
    return text;
  }

  const first = text.charAt(0).toLowerCase();
  return first + text.slice(1);
};
