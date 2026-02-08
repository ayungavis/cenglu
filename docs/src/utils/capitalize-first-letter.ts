/**
 * Capitalize the first letter of the given string.
 *
 * This function returns the original string if it's empty. It does not
 * modify the rest of the string other than upper-casing the first character.
 *
 * @param text - The input string to capitalize.
 * @returns The input string with the first character converted to upper case.
 *
 * @example
 * // Basic usage
 * import { capitalizeFirstLetter } from './capitalize-first-letter';
 *
 * const result = capitalizeFirstLetter('hello');
 * // result === 'Hello'
 *
 * @example
 * // Edge case: empty string
 * capitalizeFirstLetter('');
 * // returns ''
 */
export const capitalizeFirstLetter = (text: string): string => {
  if (text.length === 0) {
    return text;
  }
  return text.charAt(0).toUpperCase() + text.slice(1);
};
