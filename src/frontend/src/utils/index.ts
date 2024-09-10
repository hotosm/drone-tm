/* eslint-disable import/prefer-default-export */
import { clsx, type ClassValue } from 'clsx';
import { twMerge } from 'tailwind-merge';

export function cn(...inputs: ClassValue[]) {
  return twMerge(clsx(inputs));
}

/**
 * Removes specified keys from an object.
 *
 * @param {Object} obj - The original object to remove keys from.
 * @param {Array<string>} keysToRemove - An array of key names to be removed from the object.
 * @returns {Object} A new object with the specified keys removed.
 *
 * @example
 * const originalObj = { a: 1, b: 2, c: 3, d: 4 };
 * const keysToRemove = ['b', 'd'];
 * const result = removeKeys(originalObj, keysToRemove);
 * // result is { a: 1, c: 3 }
 */
export function removeKeysFromObject(
  obj: Record<string, any>,
  keysToRemove: any[],
) {
  return Object.fromEntries(
    Object.entries(obj).filter(([key]) => !keysToRemove.includes(key)),
  );
}

export const m2ToKm2 = (m2: number) => {
  if (!m2) return 0;
  if (m2 >= 1000 * 1000) return `${m2 / (1000 * 1000)} km²`;
  return `${m2} m²`;
};

const GsdToAltConst = 29.7;
export const gsdToAltitude = (gsd: number): number => {
  if (!gsd) return 0;
  return gsd * GsdToAltConst;
};

export const altitudeToGsd = (altitude: number): number => {
  if (!altitude) return 0;
  return altitude / GsdToAltConst;
};

// constant values
const VerticalFOV = 0.71;
const HorizontalFOV = 1.26;

export const getForwardSpacing = (agl: number, frontOverlap: number) => {
  const forwardPhotoHeight = agl * VerticalFOV;
  const frontOverlapDistance = (forwardPhotoHeight * frontOverlap) / 100;
  const forwardSpacing = forwardPhotoHeight - frontOverlapDistance;
  return forwardSpacing;
};

export const getSideSpacing = (agl: number, sideOverlap: number) => {
  const sidePhotoWidth = agl * HorizontalFOV;
  const sideOverlapDistance = (sidePhotoWidth * sideOverlap) / 100;
  const sideSpacing = sidePhotoWidth - sideOverlapDistance;
  return sideSpacing;
};

export const getSideOverlap = (agl: number, sideSpacing: number) => {
  const sidePhotoWidth = agl * HorizontalFOV;
  const sideOverlapDistance = sidePhotoWidth - sideSpacing;
  const sideOverlap = (sideOverlapDistance * 100) / sidePhotoWidth;
  return sideOverlap.toFixed(2);
};

export const getFrontOverlap = (agl: number, forwardSpacing: number) => {
  const frontPhotoHeight = agl * VerticalFOV;
  const frontOverlapDistance = frontPhotoHeight - forwardSpacing;
  const frontOverlap = (frontOverlapDistance * 100) / frontPhotoHeight;
  return frontOverlap.toFixed(2);
};
