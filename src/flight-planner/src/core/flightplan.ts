import {
  applyFlatPlacemarks,
  applyTerrainFollowing,
  buildFlightpathGeojson,
  DRONE_SPECS,
  DroneType,
  FlightMode,
  generate,
  GimbalAngle,
} from "./qfield";
import type {
  DroneTypeKey,
  FlightModeKey,
  FlightParameters,
  FlightpathCollection,
  GenerateConfig,
  GimbalAngleKey,
  WaypointCollection,
} from "./types";
import type { DemSampler } from "./dem";
import { NODATA_FLOOR } from "./dem";

export { DRONE_SPECS, DroneType, FlightMode, GimbalAngle };

export interface TakeoffPoint {
  lon: number;
  lat: number;
}

export interface PlanParams {
  droneType: DroneTypeKey;
  gimbalAngle: GimbalAngleKey;
  flightMode: FlightModeKey;
  useGsd: boolean;
  gsd: number;
  agl: number;
  forwardOverlap: number;
  sideOverlap: number;
  autoRotation: boolean;
  rotationAngle: number;
  imageInterval: number;
  terrainFollow: boolean;
  threshold: number;
  takeoffPoint: TakeoffPoint | null;
}

export const DEFAULT_PARAMS: PlanParams = {
  droneType: "DJI_MINI_4_PRO",
  gimbalAngle: "-80",
  flightMode: "waylines",
  useGsd: true,
  gsd: 4,
  agl: 115,
  forwardOverlap: 75,
  sideOverlap: 75,
  autoRotation: true,
  rotationAngle: 0,
  imageInterval: 2,
  terrainFollow: true,
  threshold: 5,
  takeoffPoint: null,
};

export interface PlanResult {
  waypoints: WaypointCollection;
  flightpath: FlightpathCollection;
  parameters: FlightParameters;
  batteryWarning: boolean;
  estimatedFlightTimeMinutes: number;
  terrainFollowing: boolean;
  sampled?: { ok: number; missing: number };
}

function toGenerateConfig(params: PlanParams, flightMode: FlightModeKey): GenerateConfig {
  return {
    agl: params.agl,
    gsd: params.useGsd ? params.gsd : null,
    forwardOverlap: params.forwardOverlap,
    sideOverlap: params.sideOverlap,
    rotationAngle: params.autoRotation ? 0 : params.rotationAngle,
    autoRotation: params.autoRotation,
    flightMode,
    droneType: params.droneType,
    gimbalAngle: params.gimbalAngle,
    imageInterval: params.imageInterval,
  };
}

// Sample terrain before simplifying waylines so elevation changes are retained.
export function buildPlan(
  ring: Array<[number, number]>,
  params: PlanParams,
  dem: DemSampler | null,
): PlanResult {
  const terrainFollowing = params.terrainFollow && dem !== null;

  const generateMode: FlightModeKey =
    terrainFollowing && params.flightMode === "waylines" ? "waypoints" : params.flightMode;

  const result = generate(ring, toGenerateConfig(params, generateMode));

  if (!terrainFollowing || !dem) {
    const waypoints = applyFlatPlacemarks(result.geojson, result.parameters);
    return {
      waypoints,
      flightpath: buildFlightpathGeojson(waypoints, params.takeoffPoint),
      parameters: result.parameters,
      batteryWarning: result.batteryWarning,
      estimatedFlightTimeMinutes: result.estimatedFlightTimeMinutes,
      terrainFollowing: false,
    };
  }

  let ok = 0;
  let missing = 0;
  for (const feature of result.geojson.features) {
    const coords = feature.geometry.coordinates;
    const elevation = dem.sample(coords[0], coords[1]);
    if (elevation !== null && Number.isFinite(elevation) && elevation > NODATA_FLOOR) {
      if (coords.length < 3) coords.push(elevation);
      else coords[2] = elevation;
      ok++;
    } else {
      missing++;
    }
  }

  const takeoffElevation = params.takeoffPoint
    ? dem.sample(params.takeoffPoint.lon, params.takeoffPoint.lat)
    : null;

  const placemarks = applyTerrainFollowing(
    result.geojson,
    result.parameters,
    params.flightMode,
    takeoffElevation,
    params.threshold,
  );

  return {
    waypoints: placemarks,
    flightpath: buildFlightpathGeojson(placemarks, params.takeoffPoint),
    parameters: result.parameters,
    batteryWarning: result.batteryWarning,
    estimatedFlightTimeMinutes: result.estimatedFlightTimeMinutes,
    terrainFollowing: true,
    sampled: { ok, missing },
  };
}

export function batteryBudget(
  droneType: DroneTypeKey,
  estimatedMinutes: number,
): { limitMinutes: number; fraction: number } | null {
  const spec = DRONE_SPECS[droneType];
  if (!spec?.max_battery_life_minutes) return null;
  const limit =
    spec.max_battery_life_minutes.tested_value || spec.max_battery_life_minutes.quoted_value;
  if (!limit) return null;
  return { limitMinutes: limit, fraction: estimatedMinutes / limit };
}
