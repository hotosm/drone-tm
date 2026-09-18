import { ringBbox, type Bbox } from "./dem";

export interface AoiResult {
  ring: Array<[number, number]>;
  bbox: Bbox;
  areaM2: number;
}

export class AoiError extends Error {
  readonly guidance: string;
  constructor(message: string, guidance: string) {
    super(message);
    this.name = "AoiError";
    this.guidance = guidance;
  }
}

/** Approximate geodesic area for a small polygon. */
export function ringAreaM2(ring: Array<[number, number]>): number {
  if (ring.length < 4) return 0;
  const R = 6378137;
  const rad = Math.PI / 180;
  let total = 0;
  for (let i = 0; i < ring.length - 1; i++) {
    const [lon1, lat1] = ring[i];
    const [lon2, lat2] = ring[i + 1];
    total += (lon2 - lon1) * rad * (2 + Math.sin(lat1 * rad) + Math.sin(lat2 * rad));
  }
  return Math.abs((total * R * R) / 2);
}

export function formatArea(areaM2: number): string {
  const hectares = areaM2 / 10_000;
  if (hectares < 1) return `${Math.round(areaM2).toLocaleString()} m²`;
  if (hectares < 100) return `${hectares.toFixed(1)} ha`;
  return `${(areaM2 / 1_000_000).toFixed(2)} km²`;
}

function singlePolygonRing(geojson: unknown): Array<[number, number]> | null {
  const rings: Array<Array<[number, number]>> = [];

  const walk = (node: unknown): void => {
    if (!node || typeof node !== "object") return;
    const obj = node as Record<string, unknown>;

    if (obj.type === "FeatureCollection" && Array.isArray(obj.features)) {
      obj.features.forEach(walk);
      return;
    }
    if (obj.type === "Feature") {
      walk(obj.geometry);
      return;
    }

    if (obj.type === "Polygon" && Array.isArray(obj.coordinates)) {
      const coordinates = obj.coordinates as unknown[];
      if (coordinates.length > 1) {
        throw new AoiError(
          "Flight areas with holes are not supported.",
          "Upload one outer polygon without interior rings.",
        );
      }
      if (Array.isArray(coordinates[0])) {
        rings.push(coordinates[0] as Array<[number, number]>);
      }
      return;
    }
    if (obj.type === "MultiPolygon" && Array.isArray(obj.coordinates)) {
      for (const polygon of obj.coordinates as unknown[]) {
        walk({ type: "Polygon", coordinates: polygon });
      }
    }
  };

  walk(geojson);
  if (rings.length > 1) {
    throw new AoiError(
      "That file contains multiple flight areas.",
      "Upload one polygon at a time.",
    );
  }
  return rings[0] ?? null;
}

function segmentsIntersect(
  a: [number, number],
  b: [number, number],
  c: [number, number],
  d: [number, number],
): boolean {
  const cross = (p: [number, number], q: [number, number], r: [number, number]) =>
    (q[0] - p[0]) * (r[1] - p[1]) - (q[1] - p[1]) * (r[0] - p[0]);
  const onSegment = (p: [number, number], q: [number, number], r: [number, number]) =>
    Math.min(p[0], r[0]) <= q[0] &&
    q[0] <= Math.max(p[0], r[0]) &&
    Math.min(p[1], r[1]) <= q[1] &&
    q[1] <= Math.max(p[1], r[1]);

  const abC = cross(a, b, c);
  const abD = cross(a, b, d);
  const cdA = cross(c, d, a);
  const cdB = cross(c, d, b);
  if (abC * abD < 0 && cdA * cdB < 0) return true;
  return (
    (abC === 0 && onSegment(a, c, b)) ||
    (abD === 0 && onSegment(a, d, b)) ||
    (cdA === 0 && onSegment(c, a, d)) ||
    (cdB === 0 && onSegment(c, b, d))
  );
}

function ringSelfIntersects(ring: Array<[number, number]>): boolean {
  const edgeCount = ring.length - 1;
  for (let first = 0; first < edgeCount; first++) {
    for (let second = first + 1; second < edgeCount; second++) {
      const adjacent = second === first + 1 || (first === 0 && second === edgeCount - 1);
      if (adjacent) continue;
      if (segmentsIntersect(ring[first], ring[first + 1], ring[second], ring[second + 1])) {
        return true;
      }
    }
  }
  return false;
}

export function validateRing(input: Array<[number, number]>): AoiResult {
  if (!Array.isArray(input) || input.length < 3) {
    throw new AoiError(
      "That area has fewer than three corners.",
      "Draw the area on the map instead, or check the file.",
    );
  }

  const ring = input.map((position, index) => {
    if (
      !Array.isArray(position) ||
      typeof position[0] !== "number" ||
      typeof position[1] !== "number" ||
      !Number.isFinite(position[0]) ||
      !Number.isFinite(position[1])
    ) {
      throw new AoiError(
        `Corner ${index + 1} is not a valid coordinate pair.`,
        "The file may be damaged. Try drawing the area on the map.",
      );
    }
    const [lon, lat] = position;
    if (Math.abs(lon) > 180 || Math.abs(lat) > 90) {
      throw new AoiError(
        "Those coordinates are not longitude and latitude.",
        "The file is probably in a projected coordinate system. Re-export it as " +
          "EPSG:4326 (WGS 84), or draw the area on the map.",
      );
    }
    return [lon, lat] as [number, number];
  });

  const [firstLon, firstLat] = ring[0];
  const [lastLon, lastLat] = ring[ring.length - 1];
  if (firstLon !== lastLon || firstLat !== lastLat) ring.push([firstLon, firstLat]);

  const bbox = ringBbox(ring);
  if (bbox[0] === bbox[2] || bbox[1] === bbox[3]) {
    throw new AoiError("That area has no width or height.", "Draw a shape with some size to it.");
  }

  // A crossing polygon's bounds span the globe and cannot be cropped safely.
  if (bbox[2] - bbox[0] > 180) {
    throw new AoiError(
      "That area appears to cross the antimeridian (180° longitude).",
      "Split it into two areas, one either side of the line.",
    );
  }

  if (ringSelfIntersects(ring)) {
    throw new AoiError(
      "That area's edges cross each other.",
      "Draw a simple outline without overlapping edges.",
    );
  }

  const areaM2 = ringAreaM2(ring);
  if (areaM2 === 0) {
    throw new AoiError("That area has no usable surface.", "Draw a non-intersecting polygon.");
  }

  return { ring, bbox, areaM2 };
}

export async function readAoiFile(file: File): Promise<AoiResult> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new AoiError(
      `"${file.name}" is not valid JSON.`,
      "Upload a .geojson file, or draw the area on the map.",
    );
  }

  const ring = singlePolygonRing(parsed);
  if (!ring) {
    throw new AoiError(
      `No polygon found in "${file.name}".`,
      "The file needs a Polygon or MultiPolygon. Points and lines cannot define a flight area.",
    );
  }
  return validateRing(ring);
}

export async function fetchAoi(url: string): Promise<AoiResult> {
  const response = await fetch(url);
  if (!response.ok) {
    throw new AoiError(
      `Could not load the area (${response.status}).`,
      "The link may have expired. Draw the area on the map instead.",
    );
  }
  const ring = singlePolygonRing(await response.json());
  if (!ring) {
    throw new AoiError("That link did not contain a polygon.", "Draw the area on the map instead.");
  }
  return validateRing(ring);
}
