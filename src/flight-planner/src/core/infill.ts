// A flight to just the missing photo points the checker shows, starting and ending above takeoff.
// Heights come from the planner's own code, so each photo matches the original flight.

import { NODATA_FLOOR, type DemSampler } from "./dem";
import type { TakeoffPoint } from "./flightplan";
import type { MissionRoute } from "./outputs";
import type { PhotoGap } from "./photo-coverage";
import type { PhotoInfo } from "./photos";
import { applyTerrainFollowing, buildFlightpathGeojson, toMercator } from "./qfield";
import type { GimbalAngleKey, WaypointFeature } from "./types";

type LonLat = [number, number];
type Xy = { x: number; y: number };

/** DJI's default. Slow is fine, as the drone stops at every point anyway. */
export const INFILL_SPEED_MS = 2.5;

export interface InfillOptions {
  gimbalAngle: GimbalAngleKey;
  dem: DemSampler;
  aglM: number;
  takeoff: TakeoffPoint;
}

export class InfillError extends Error {}

function distance(a: Xy, b: Xy): number {
  return Math.hypot(a.x - b.x, a.y - b.y);
}

function toXy([lon, lat]: LonLat): Xy {
  return toMercator(lon, lat);
}

/** From takeoff, flies to the nearest gap next, entering it from its closer end. */
function route(gaps: PhotoGap[], home: LonLat): LonLat[][] {
  const remaining = gaps.map((gap) => gap.missed).filter((run) => run.length > 0);
  const runs: LonLat[][] = [];
  let here = toXy(home);
  while (remaining.length > 0) {
    let best = { index: 0, reversed: false, metres: Infinity };
    remaining.forEach((run, index) => {
      const toFirst = distance(here, toXy(run[0]));
      const toLast = distance(here, toXy(run[run.length - 1]));
      if (toFirst < best.metres) best = { index, reversed: false, metres: toFirst };
      if (toLast < best.metres) best = { index, reversed: true, metres: toLast };
    });
    const [run] = remaining.splice(best.index, 1);
    const ordered = best.reversed ? [...run].reverse() : run;
    runs.push(ordered);
    here = toXy(ordered[ordered.length - 1]);
  }
  return runs;
}

function groundOrNull(dem: DemSampler, lon: number, lat: number): number | null {
  const elevation = dem.sample(lon, lat);
  return elevation !== null && elevation > NODATA_FLOOR ? elevation : null;
}

function ground(dem: DemSampler, [lon, lat]: LonLat): number {
  const elevation = groundOrNull(dem, lon, lat);
  if (elevation !== null) return elevation;
  throw new InfillError("Terrain data is missing at a point on this flight.");
}

/**
 * Photos record height above takeoff, not above ground, so this needs the takeoff point.
 * A wrong guess shifts the result by the height difference between the two points.
 */
export function estimateAglM(
  photos: PhotoInfo[],
  dem: DemSampler,
  assumedTakeoff: TakeoffPoint,
): number | null {
  const takeoffGround = groundOrNull(dem, assumedTakeoff.lon, assumedTakeoff.lat);
  const offsets = photos
    .map((photo) => {
      const below = groundOrNull(dem, photo.lon, photo.lat);
      return photo.heightM === null || below === null ? null : photo.heightM - below;
    })
    .filter((offset): offset is number => offset !== null)
    .sort((a, b) => a - b);
  if (takeoffGround === null || offsets.length === 0) return null;
  // The median ignores the odd photo taken while climbing or with a GPS glitch.
  const median = offsets[Math.floor(offsets.length / 2)];
  return Math.round(median + takeoffGround);
}

/** Compass heading, -180 to 180 as DJI expects. */
function bearing(from: LonLat, to: LonLat): number {
  const a = toXy(from);
  const b = toXy(to);
  return (Math.atan2(b.x - a.x, b.y - a.y) * 180) / Math.PI;
}

export function buildInfillPlan(gaps: PhotoGap[], options: InfillOptions): MissionRoute {
  const { gimbalAngle, dem, aglM, takeoff } = options;
  const home: LonLat = [takeoff.lon, takeoff.lat];
  const photos = route(gaps, home).flat();
  // Above takeoff first and last, so the climb out and the way back are at flight height.
  const path = [home, ...photos, home];

  const features = path.map((point, index): WaypointFeature => {
    // The last point faces the way it arrived.
    const next = path[index + 1];
    const [from, to] = next ? [point, next] : [path[index - 1] ?? point, point];
    const [lon, lat] = point;
    return {
      type: "Feature",
      // Ground height for now. The planner's code turns it into flying height below.
      geometry: { type: "Point", coordinates: [lon, lat, ground(dem, point)] },
      properties: {
        index,
        heading: bearing(from, to),
        take_photo: index > 0 && index < path.length - 1,
        gimbal_angle: gimbalAngle,
        speed: INFILL_SPEED_MS,
      },
    };
  });
  const parameters = { ground_speed: INFILL_SPEED_MS, altitude_above_ground_level: aglM };
  const waypoints = applyTerrainFollowing(
    { type: "FeatureCollection", features },
    parameters,
    "waypoints",
    ground(dem, home),
  );
  return {
    waypoints,
    flightpath: buildFlightpathGeojson(waypoints, takeoff),
    parameters,
  };
}
