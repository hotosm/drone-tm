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

function rowLetter(index: number): string {
  let n = index;
  let letters = "";
  do {
    letters = String.fromCharCode(65 + (n % 26)) + letters;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return letters;
}

// Labels tasks like a spreadsheet grid (A1, A2, B1, B2, ...) based on the
// position of each cell's bbox center, using the known cell size to work out
// row/column indices even where the grid is clipped to an irregular AOI.
export function assignGridLabels<T extends { id: string; geometry: Polygon }>(
  tasks: T[],
  cellSizeMeters: number,
): Record<string, string> {
  if (!tasks.length) return {};

  const centers = tasks.map((task) => ({
    id: task.id,
    center: polygonBboxCenter(task.geometry),
  }));
  const avgLat = centers.reduce((sum, { center }) => sum + center[1], 0) / centers.length;
  const maxLat = Math.max(...centers.map(({ center }) => center[1]));
  const minLng = Math.min(...centers.map(({ center }) => center[0]));

  const cellHeightDeg = cellSizeMeters / 111_000;
  const cellWidthDeg = cellSizeMeters / (111_000 * Math.cos((avgLat * Math.PI) / 180));

  const labels: Record<string, string> = {};
  centers.forEach(({ id, center: [lng, lat] }) => {
    const row = Math.round((maxLat - lat) / cellHeightDeg);
    const col = Math.round((lng - minLng) / cellWidthDeg);
    labels[id] = `${rowLetter(row)}${col + 1}`;
  });
  return labels;
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
