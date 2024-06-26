/* eslint-disable import/no-extraneous-dependencies */
/* eslint-disable no-prototype-builtins */
/* eslint-disable no-restricted-syntax */

/**
 *
 * @param obj
 * @returns
 */
export function hasBinaryData(obj: Record<string, any>): boolean {
  if (typeof obj !== 'object') {
    return false;
  }

  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      if (
        value instanceof Blob ||
        value instanceof File ||
        value instanceof ArrayBuffer
      ) {
        return true;
      }
      if (typeof value === 'object' && hasBinaryData(value)) {
        return true;
      }
    }
  }

  return false;
}

/**
 *
 * @param obj
 * @returns
 */
export function convertJsonToFormData(obj: Record<string, any>): FormData {
  const formData = new FormData();
  for (const key in obj) {
    if (obj.hasOwnProperty(key)) {
      const value = obj[key];
      if (Array.isArray(value)) {
        for (let i = 0; i < value.length; i++) {
          formData.append(key, value[i]);
        }
      } else {
        formData.append(key, value);
      }
    }
  }
  return formData;
}

/**
 *
 * @param obj1
 * @param obj2
 * @returns
 */

export function objectsAreEqual(obj1: any, obj2: any): boolean {
  if (obj1 === obj2) {
    return true;
  }

  if (obj1 == null || obj2 == null) {
    return false;
  }

  const obj1Keys = Object.keys(obj1);
  const obj2Keys = Object.keys(obj2);
  if (obj1Keys.length !== obj2Keys.length) {
    return false;
  }

  for (const key of obj1Keys) {
    if (!obj2.hasOwnProperty(key)) {
      return false;
    }
    const value1 = obj1[key];
    const value2 = obj2[key];
    if (value1 !== value2) {
      return false;
    }
  }

  return true;
}

/**
 * This TypeScript function calculates the percentage of a value in relation to a total.
 * @param {number} total - The total number or quantity that the value is being compared to.
 * @param {number} value - The value parameter represents the numerical value that you want to
 * calculate the percentage of.
 * @returns The function `calculatePercentage` returns a number, which is the percentage calculated
 * based on the `total` and `value` parameters passed to the function. If the `total` parameter is 0,
 * the function returns 0.
 */
export function calculatePercentage(total: number, value: number): number {
  if (total === 0) {
    return 0;
  }
  return (value / total) * 100;
}

/**
 * This TypeScript function removes a specified key from an object and returns a new object without
 * that key.
 * @param {T} obj - The object from which a key needs to be removed.
 * @param {K} key - The `key` parameter is the property key of the object that needs to be removed. It
 * is of type `K`, which is a generic type that extends the keys of the input object `T`. This ensures
 * that the `key` parameter is a valid property key of the input object.
 * @returns a new object that is the same as the input object, but with the specified key removed. The
 * returned object has a type of `Omit<T, K>`, which means it has all the same properties as the input
 * object `T`, except for the property with key `K`.
 */
export function removeKeyFromObject<T, K extends keyof T>(
  obj: T,
  key: K,
): Omit<T, K> {
  const { [key]: omitted, ...rest } = obj;
  return rest;
}

/**
 * This TypeScript function calculates the sum of a specified key in an array of objects.
 * @param {Record<string, any>[]} data - An array of objects where each object has one or more
 * key-value pairs.
 * @param {string} key - The `key` parameter is a string representing the key of the property in each
 * object of the `data` array that we want to sum up.
 * @returns the sum of the values of a given key in an array of objects. If the array is empty, it
 * returns 0.
 */
export function getSumOfKey(data: Record<string, any>[], key: string) {
  if (data.length === 0) {
    return 0;
  }
  const total = data
    .map((item: any) => item[key])
    .reduce((sum: number, item: any) => {
      const y = sum + +item;
      return y;
    });
  return total;
}

export function calculatePercentageAndInjectValue(
  arr: Record<string, any>[],
  key: string,
) {
  const maxValue = Math.max(...arr.map(obj => obj[key]));
  for (const obj of arr) {
    obj.percentage = parseFloat(((obj[key] / maxValue) * 100).toFixed(2));
  }
  return arr;
}

/**
 * The IntersectionOfObjects function takes two objects as input and returns a new object that contains
 * only the properties that exist in both input objects.
 * @param obj1 - An object of type `Record<string, any>`, which means it can have any number of
 * properties of any type.
 * @param obj2 - The `obj2` parameter is a record object that contains key-value pairs.
 * @returns The function `IntersectionOfObjects` returns a new object that contains the intersection of
 * properties between `obj1` and `obj2`.
 */
export function IntersectionOfObjects(
  obj1: Record<string, any>,
  obj2: Record<string, any>,
): Record<string, any> {
  const obj2Keys = Object.keys(obj2);
  if (!obj2Keys.length) return {};
  const intersectedObj = obj2Keys.reduce(
    (acc: Record<string, any>, item: string) => {
      if (obj1[item]) acc[item] = obj1[item];
      return acc;
    },
    {},
  );
  return intersectedObj;
}

export function scrollToComponent(componentId: string) {
  const element = document.getElementById(componentId);

  if (element) {
    element.scrollIntoView({
      behavior: 'smooth',
      block: 'center',
    });
    // element.focus();
    // setTimeout(() => {
    // }, 800);
    // element.focus();
  }
}

/**
 * The function converts an input object with nested keys in the format of "name[index].nestedKey" into
 * an output object with nested arrays and objects.
 * @param input - The input parameter is a JavaScript object with string keys and any values.
 * @returns an object with the converted input. The input is an object with string keys and any values.
 * The function converts any keys that match the pattern of "name[index].nestedKey" into nested objects
 * within an array. The function returns the converted object.
 */
export function convertObject(input: Record<string, any>): any {
  const output: Record<string, any> = {};
  for (const key in input) {
    if (input.hasOwnProperty(key)) {
      const match = key.match(/^(.*?)\[(\d+)\]\.(.*)$/);
      if (match) {
        const name = match[1];
        const index = match[2];
        const nestedKey = match[3];

        if (!output[name]) {
          output[name] = [];
        }
        if (!output[name][index]) {
          output[name][index] = {};
        }

        output[name][index][nestedKey] = input[key];
      } else {
        output[key] = input[key];
      }
    }
  }
  return output;
}
