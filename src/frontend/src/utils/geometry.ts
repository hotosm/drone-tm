import { Polygon } from "geojson";

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
