/* eslint-disable import/prefer-default-export */
// import { radiansToDegrees } from '@turf/helpers';
// import { radiansToDegrees } from '@turf/helpers';
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
  return forwardSpacing.toFixed(2);
};

export const getSideSpacing = (agl: number, sideOverlap: number) => {
  const sidePhotoWidth = agl * HorizontalFOV;
  const sideOverlapDistance = (sidePhotoWidth * sideOverlap) / 100;
  const sideSpacing = sidePhotoWidth - sideOverlapDistance;
  return sideSpacing.toFixed(2);
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

// remove underscore and capitalize the word
export const formatString = (value: string) => {
  if (!value) return '';
  if (value === 'IMAGE_PROCESSED') return 'Completed';
  return value
    .replace(/_/g, ' ')
    .toLowerCase()
    .replace(/^\w/, char => char.toUpperCase());
};

export const getFileExtension = (url: string) => {
  const match = url.match(/\.([a-zA-Z0-9]+)(?:[?#]|$)/);
  return match ? match[1] : null;
};

export function degToRad(degrees: number) {
  return degrees * (Math.PI / 180);
}

export function lonLatToCartesian(lon: number, lat: number) {
  const latRad = degToRad(lat);
  const lonRad = degToRad(lon);
  return {
    x: Math.cos(latRad) * Math.cos(lonRad),
    y: Math.cos(latRad) * Math.sin(lonRad),
    z: Math.sin(latRad),
  };
}

export function calculateAngle(
  initialCoordinates: [number, number],
  afterCoordinates: [number, number],
  centroid: [number, number],
) {
  // Convert longitude/latitude to Cartesian coordinates
  const beforeCart = lonLatToCartesian(
    initialCoordinates[0],
    initialCoordinates[1],
  );
  const afterCart = lonLatToCartesian(afterCoordinates[0], afterCoordinates[1]);
  const centroidCart = lonLatToCartesian(centroid[0], centroid[1]);

  // Calculate vectors from the centroid
  const vectorBefore = {
    x: beforeCart.x - centroidCart.x,
    y: beforeCart.y - centroidCart.y,
    z: beforeCart.z - centroidCart.z,
  };

  const vectorAfter = {
    x: afterCart.x - centroidCart.x,
    y: afterCart.y - centroidCart.y,
    z: afterCart.z - centroidCart.z,
  };

  // Dot product of the vectors
  const dotProduct =
    vectorBefore.x * vectorAfter.x +
    vectorBefore.y * vectorAfter.y +
    vectorBefore.z * vectorAfter.z;

  // Magnitudes of the vectors
  const magnitudeBefore = Math.sqrt(
    vectorBefore.x ** 2 + vectorBefore.y ** 2 + vectorBefore.z ** 2,
  );
  const magnitudeAfter = Math.sqrt(
    vectorAfter.x ** 2 + vectorAfter.y ** 2 + vectorAfter.z ** 2,
  );

  // Calculate the angle in radians using the dot product formula
  const cosTheta = dotProduct / (magnitudeBefore * magnitudeAfter);

  // Clamp the value to the range [-1, 1] to avoid precision errors
  const clampedCosTheta = Math.max(-1, Math.min(1, cosTheta));

  const angleInRadians = Math.acos(clampedCosTheta);

  // Use cross product to determine the direction of rotation
  const crossProduct = {
    x: vectorBefore.y * vectorAfter.z - vectorBefore.z * vectorAfter.y,
    y: vectorBefore.z * vectorAfter.x - vectorBefore.x * vectorAfter.z,
    z: vectorBefore.x * vectorAfter.y - vectorBefore.y * vectorAfter.x,
  };

  // Determine the direction based on the cross product
  const direction = crossProduct.z < 0 ? 1 : -1; // Reverse the direction check here

  // Convert radians to degrees and apply the direction
  const angleInDegrees = angleInRadians * (180 / Math.PI) * direction;

  // Ensure the angle is within the range [0, 360]
  return (angleInDegrees + 360) % 360;
}
function RadtoDegrees(radians: number) {
  return radians * (180 / Math.PI);
}
export function calculateCentroid(bbox: number[]) {
  const [minLon, minLat, maxLon, maxLat] = bbox;

  const centroidLat = (minLat + maxLat) / 2;
  const centroidLon = (minLon + maxLon) / 2;

  return { lng: centroidLon, lat: centroidLat };
}

export function calculateCentroidFromCoordinates(coordinates: any[]) {
  let x = 0;
  let y = 0;
  let z = 0;
  const n = coordinates.length;

  for (let i = 0; i < n; i++) {
    const lat = degToRad(coordinates[i][0]);
    const lon = degToRad(coordinates[i][1]);

    // Convert lat, lon to Cartesian coordinates
    x += Math.cos(lat) * Math.cos(lon);
    y += Math.cos(lat) * Math.sin(lon);
    z += Math.sin(lat);
  }

  // Calculate average x, y, z
  x /= n;
  y /= n;
  z /= n;

  // Convert back to latitude and longitude
  const lon = Math.atan2(y, x);
  const hyp = Math.sqrt(x * x + y * y);
  const lat = Math.atan2(z, hyp);

  // Convert the results to degrees
  return [RadtoDegrees(lat), RadtoDegrees(lon)];
}

type Coordinate = [number, number];
type GeoJSONFeature = {
  type: 'Feature';
  geometry: {
    type: 'LineString' | 'Polygon';
    coordinates: Coordinate[] | Coordinate[][];
  };
  properties: Record<string, any>;
};

export function swapFirstAndLastCoordinate(
  geojson: GeoJSONFeature,
): GeoJSONFeature {
  // Clone the GeoJSON object to avoid mutation
  const updatedGeoJSON: GeoJSONFeature = {
    ...geojson,
    geometry: { ...geojson.geometry },
  };

  if (geojson.geometry.type === 'LineString') {
    const coordinates = [...(geojson.geometry.coordinates as Coordinate[])];

    // Swap the first and last coordinates
    [coordinates[0], coordinates[coordinates.length - 1]] = [
      coordinates[coordinates.length - 1],
      coordinates[0],
    ];
    updatedGeoJSON.geometry.coordinates = coordinates;
  }

  return updatedGeoJSON;
}

export function findNearestCoordinate(
  coord1: number[],
  coord2: number[],
  center: number[],
) {
  // Function to calculate distance between two points
  const calculateDistance = (point1: number[], point2: number[]) => {
    const xDiff = point2[0] - point1[0];
    const yDiff = point2[1] - point1[1];
    return Math.sqrt(xDiff * xDiff + yDiff * yDiff);
  };

  // Calculate the distance of the first and second coordinates from the center
  const distance1 = calculateDistance(coord1, center);
  const distance2 = calculateDistance(coord2, center);

  // Return the nearest coordinate
  return distance1 <= distance2 ? 'first' : 'second';
}

export function swapFirstAndLast<T>(arr: T[]): T[] {
  if (arr.length < 2) {
    throw new Error('Array must have at least two elements to swap.');
  }

  // Swap the first and last elements using destructuring
  // eslint-disable-next-line no-param-reassign
  [arr[0], arr[arr.length - 1]] = [arr[arr.length - 1], arr[0]];

  return arr;
}
