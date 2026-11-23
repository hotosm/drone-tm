// Approximate coverage, to spot glaring gaps. Footprints use height above
// takeoff, so they drift on slopes.

import { ringAreaM2 } from "./aoi";
import type { PhotoInfo } from "./photos";

type LonLat = [number, number];
type Xy = [number, number];

const PLANNED_OVERLAP = 0.75;
// About 16 photos see each point at 75/75.
const EXPECTED_PHOTOS = 1 / (1 - PLANNED_OVERLAP) ** 2;
// Below half means about three neighbouring lines are missing.
const LOW_PHOTO_COUNT = EXPECTED_PHOTOS / 2;

const TARGET_CELLS = 10_000;
const FULL_FRAME_WIDTH_MM = 36;
const M_PER_DEG_LAT = 111_320;
const GOOD_MAX_LOW_SHARE = 0.02;
const REFLY_MIN_MISSING_SHARE = 0.1;

export type CellStatus = "missing" | "low" | "ok";
/** "unknown": no photo had the height and lens data to size it. */
export type Verdict = "good" | "gaps" | "refly" | "unknown";

export interface Coverage {
  cells: Array<{ ring: LonLat[]; status: CellStatus }>;
  missingShare: number;
  lowShare: number;
  verdict: Verdict;
  outsideCount: number;
  unsizedCount: number;
}

interface Footprint {
  centre: Xy;
  sin: number;
  cos: number;
  halfAcross: number;
  halfAlong: number;
}

function localProjection([lon0, lat0]: LonLat) {
  const mPerDegLon = M_PER_DEG_LAT * Math.cos((lat0 * Math.PI) / 180);
  return {
    toXy: ([lon, lat]: LonLat): Xy => [(lon - lon0) * mPerDegLon, (lat - lat0) * M_PER_DEG_LAT],
    toLonLat: ([x, y]: Xy): LonLat => [lon0 + x / mPerDegLon, lat0 + y / M_PER_DEG_LAT],
  };
}

function insideRing(ring: Xy[], [x, y]: Xy): boolean {
  let inside = false;
  for (let i = 0, j = ring.length - 1; i < ring.length; j = i++) {
    const [xi, yi] = ring[i];
    const [xj, yj] = ring[j];
    const crosses = yi > y !== yj > y && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi;
    if (crosses) inside = !inside;
  }
  return inside;
}

/** The image's long side runs across the camera heading. */
function footprint(photo: PhotoInfo, centre: Xy): Footprint | null {
  if (!photo.heightM || !photo.focal35mm) return null;
  const across = (photo.heightM * FULL_FRAME_WIDTH_MM) / photo.focal35mm;
  const yaw = (photo.yawDeg * Math.PI) / 180;
  return {
    centre,
    sin: Math.sin(yaw),
    cos: Math.cos(yaw),
    halfAcross: across / 2,
    halfAlong: across / photo.aspect / 2,
  };
}

function covers(fp: Footprint, [x, y]: Xy): boolean {
  const dx = x - fp.centre[0];
  const dy = y - fp.centre[1];
  const along = dx * fp.sin + dy * fp.cos;
  const across = dx * fp.cos - dy * fp.sin;
  return Math.abs(across) <= fp.halfAcross && Math.abs(along) <= fp.halfAlong;
}

function statusFor(count: number): CellStatus {
  if (count === 0) return "missing";
  return count < LOW_PHOTO_COUNT ? "low" : "ok";
}

function verdictFor(missingShare: number, lowShare: number, sizedCount: number): Verdict {
  if (sizedCount === 0) return "unknown";
  if (missingShare > REFLY_MIN_MISSING_SHARE) return "refly";
  // At 75/75 overlap any hole inside the task is real.
  return missingShare > 0 || lowShare > GOOD_MAX_LOW_SHARE ? "gaps" : "good";
}

export function assessCoverage(area: LonLat[], photos: PhotoInfo[]): Coverage {
  const projection = localProjection(area[0]);
  const ring = area.map(projection.toXy);
  const centres = photos.map((photo) => projection.toXy([photo.lon, photo.lat]));
  const footprints = photos
    .map((photo, i) => footprint(photo, centres[i]))
    .filter((fp): fp is Footprint => fp !== null);

  const xs = ring.map(([x]) => x);
  const ys = ring.map(([, y]) => y);
  const step = Math.sqrt(ringAreaM2(area) / TARGET_CELLS);
  const half = step / 2;

  const cells: Coverage["cells"] = [];
  for (let x = Math.min(...xs) + half; x < Math.max(...xs); x += step) {
    for (let y = Math.min(...ys) + half; y < Math.max(...ys); y += step) {
      if (!insideRing(ring, [x, y])) continue;
      const count = footprints.filter((fp) => covers(fp, [x, y])).length;
      const corners: Xy[] = [
        [x - half, y - half],
        [x + half, y - half],
        [x + half, y + half],
        [x - half, y + half],
        [x - half, y - half],
      ];
      cells.push({ ring: corners.map(projection.toLonLat), status: statusFor(count) });
    }
  }

  const share = (statuses: CellStatus[]) =>
    cells.filter((cell) => statuses.includes(cell.status)).length / Math.max(cells.length, 1);
  const missingShare = share(["missing"]);
  const lowShare = share(["low"]);

  return {
    cells,
    missingShare,
    lowShare,
    verdict: verdictFor(missingShare, lowShare, footprints.length),
    outsideCount: centres.filter((centre) => !insideRing(ring, centre)).length,
    unsizedCount: photos.length - footprints.length,
  };
}
