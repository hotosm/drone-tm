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

// Bounding-box center — unlike polygonCentroid (a vertex average, which skews
// toward whichever side has more vertices), this stays in the visual middle
// of a cell even when the cell is an irregular shape clipped to the AOI edge.
export function polygonBboxCenter(polygon: Polygon): [number, number] {
  const coords = polygon.coordinates[0];
  let minLng = Infinity;
  let maxLng = -Infinity;
  let minLat = Infinity;
  let maxLat = -Infinity;
  coords.forEach(([lng, lat]) => {
    if (lng < minLng) minLng = lng;
    if (lng > maxLng) maxLng = lng;
    if (lat < minLat) minLat = lat;
    if (lat > maxLat) maxLat = lat;
  });
  return [(minLng + maxLng) / 2, (minLat + maxLat) / 2];
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
