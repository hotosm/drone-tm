import transformRotate from '@turf/transform-rotate';
import centroid from '@turf/centroid';
import { Feature, FeatureCollection, Geometry } from 'geojson';

/**
 * Rotates GeoJSON data around a specified point by a given angle.
 * @param {Feature<Geometry> | FeatureCollection<Geometry>} geojson - The GeoJSON object to rotate.
 * @param {number} angle - The angle in degrees to rotate the GeoJSON.
 * @param {[number, number]} [origin] - The [longitude, latitude] to rotate around. Defaults to the GeoJSON's centroid.
 * @returns {Feature<Geometry> | FeatureCollection<Geometry>} - The rotated GeoJSON object.
 */

export default function rotateGeoJSON(
  geojson: Feature<Geometry> | FeatureCollection<Geometry>,
  angle: number,
  origin?: [number, number],
): Feature<Geometry> | FeatureCollection<Geometry> {
  // Calculate the centroid of the GeoJSON if no origin is specified
  const rotationOrigin =
    origin || (centroid(geojson).geometry.coordinates as [number, number]);

  // Perform the rotation
  const rotatedGeoJSON = transformRotate(geojson, angle, {
    pivot: rotationOrigin,
    mutate: false,
  });

  return rotatedGeoJSON;
}
