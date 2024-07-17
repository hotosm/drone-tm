/* eslint-disable no-console */
/* eslint-disable import/prefer-default-export */

/**
 * Gets and parses a value from localStorage.
 * @param {string} key - The localStorage key.
 * @param {*} [defaultValue=null] - Value to return if key not found.
 * @returns {*} Parsed value or defaultValue.
 */
export function getLocalStorageValue(key: string, defaultValue = null) {
  try {
    const item = localStorage.getItem(key);
    return item ? JSON.parse(item) : defaultValue;
  } catch (error) {
    console.error(`Error reading ${key} from localStorage:`, error);
    return defaultValue;
  }
}
