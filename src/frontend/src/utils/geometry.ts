import { Polygon } from "geojson";

export function polygonCentroid(polygon: Polygon): [number, number] {
  const coords = polygon.coordinates[0];
  const n = coords.length - 1; // exclude closing vertex
  let lngSum = 0;
  let latSum = 0;
  for (let i = 0; i < n; i++) {
    lngSum += coords[i][0];
    latSum += coords[i][1];
  }
  return [lngSum / n, latSum / n];
}

export function buildSquareKm2(center: [number, number], km2: number): Polygon {
  const [lng, lat] = center;
  const halfSideMeters = (Math.sqrt(km2) * 1000) / 2;
  const halfLat = halfSideMeters / 111000;
  const halfLng = halfSideMeters / (111000 * Math.cos((lat * Math.PI) / 180));

  return {
    type: "Polygon",
    coordinates: [
      [
        [lng - halfLng, lat - halfLat],
        [lng + halfLng, lat - halfLat],
        [lng + halfLng, lat + halfLat],
        [lng - halfLng, lat + halfLat],
        [lng - halfLng, lat - halfLat],
      ],
    ],
  };
}
