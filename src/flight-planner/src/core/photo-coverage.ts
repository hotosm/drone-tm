// Approximate coverage, to spot missed photos. Footprints use height above
// takeoff, so they drift on slopes.

import { ringAreaM2 } from "./aoi";
import type { PhotoInfo } from "./photos";

type LonLat = [number, number];
type Xy = [number, number];

const TARGET_CELLS = 10_000;
const FULL_FRAME_WIDTH_MM = 36;
const M_PER_DEG_LAT = 111_320;
const REFLY_MIN_MISSING_SHARE = 0.1;
// EXIF times are whole seconds, so a normal 2 s step can read as 3 s.
const GAP_FACTOR = 1.75;
const MAX_LINE_TURN_RAD = Math.PI / 6;

export type CellStatus = "missing" | "ok";
/** "unknown": no photo had the height and lens data to size it. */
export type Verdict = "good" | "gaps" | "refly" | "unknown";

export interface PhotoGap {
  from: PhotoInfo;
  to: PhotoInfo;
  missedCount: number;
}

export interface Coverage {
  cells: Array<{ ring: LonLat[]; status: CellStatus }>;
  missingShare: number;
  gaps: PhotoGap[];
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

function verdictFor(missingShare: number, gapCount: number, sizedCount: number): Verdict {
  if (sizedCount === 0) return "unknown";
  if (missingShare > REFLY_MIN_MISSING_SHARE) return "refly";
  return missingShare > 0 || gapCount > 0 ? "gaps" : "good";
}

/** EXIF "2026:11:20 10:00:00", in camera local time. */
function exifSeconds(text: string): number | null {
  const match = /^(\d{4}):(\d\d):(\d\d) (\d\d):(\d\d):(\d\d)/.exec(text);
  if (!match) return null;
  const [year, month, day, hour, minute, second] = match.slice(1).map(Number);
  return Date.UTC(year, month - 1, day, hour, minute, second) / 1000;
}

function median(values: number[]): number {
  const sorted = [...values].sort((a, b) => a - b);
  return sorted[Math.floor(sorted.length / 2)] ?? 0;
}

function angleBetween(a: number, b: number): number {
  const diff = Math.abs(a - b) % (2 * Math.PI);
  return Math.min(diff, 2 * Math.PI - diff);
}

/** Turns change heading and battery swaps keep normal spacing, so neither counts. */
function findGaps(photos: PhotoInfo[], centres: Xy[]): PhotoGap[] {
  const shots = photos
    .flatMap((photo, i) => {
      const seconds = exifSeconds(photo.takenAt);
      return seconds === null ? [] : [{ photo, xy: centres[i], seconds }];
    })
    .sort((a, b) => a.seconds - b.seconds || a.photo.name.localeCompare(b.photo.name));
  const steps = shots.slice(1).map((shot, i) => {
    const dx = shot.xy[0] - shots[i].xy[0];
    const dy = shot.xy[1] - shots[i].xy[1];
    return {
      seconds: shot.seconds - shots[i].seconds,
      metres: Math.hypot(dx, dy),
      heading: Math.atan2(dx, dy),
    };
  });
  const usualSeconds = median(steps.map((step) => step.seconds));
  const usualMetres = median(steps.map((step) => step.metres));

  const gaps: PhotoGap[] = [];
  steps.forEach((step, i) => {
    const late = step.seconds > usualSeconds * GAP_FACTOR;
    const far = step.metres > usualMetres * GAP_FACTOR;
    const onLine = [steps[i - 1], steps[i + 1]].some(
      (neighbour) =>
        neighbour && angleBetween(neighbour.heading, step.heading) <= MAX_LINE_TURN_RAD,
    );
    if (!late || !far || !onLine) return;
    gaps.push({
      from: shots[i].photo,
      to: shots[i + 1].photo,
      missedCount: Math.max(1, Math.round(step.metres / usualMetres) - 1),
    });
  });
  return gaps;
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
      const covered = footprints.some((fp) => covers(fp, [x, y]));
      const corners: Xy[] = [
        [x - half, y - half],
        [x + half, y - half],
        [x + half, y + half],
        [x - half, y + half],
        [x - half, y - half],
      ];
      cells.push({ ring: corners.map(projection.toLonLat), status: covered ? "ok" : "missing" });
    }
  }

  const missingCount = cells.filter((cell) => cell.status === "missing").length;
  const missingShare = missingCount / Math.max(cells.length, 1);
  const gaps = findGaps(photos, centres);

  return {
    cells,
    missingShare,
    gaps,
    verdict: verdictFor(missingShare, gaps.length, footprints.length),
    outsideCount: centres.filter((centre) => !insideRing(ring, centre)).length,
    unsizedCount: photos.length - footprints.length,
  };
}
