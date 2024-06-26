/**
 *
 * Check if an object or an array is empty.
 *
 * @param {object|array} obj  - object or array
 * @returns {boolean} boolean value whether the object or array is empty or not.
 */
export default function isEmpty(obj: object | []): boolean {
  if (!obj) return true;
  if (Array.isArray(obj)) {
    return obj.length === 0;
  }
  return Object.keys(obj)?.length === 0;
}
