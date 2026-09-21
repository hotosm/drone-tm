import * as core from "@qfield/generate/core.js";
import * as placemarks from "@qfield/generate/placemarks.js";
import * as specs from "@qfield/generate/drone_specs.js";
import * as dji from "@qfield/output/dji.js";
import * as kmz from "@qfield/output/kmz.js";
import * as potensic from "@qfield/output/potensic_v2.js";

import type {
  DroneSpec,
  DroneTypeKey,
  FlightModeKey,
  FlightParameters,
  FlightpathCollection,
  GenerateConfig,
  GenerateResult,
  GimbalAngleKey,
  PotensicBundle,
  WaypointCollection,
} from "./types";

// Typed boundary around the transformed QField JavaScript modules.

export const generate = core.generate as (
  polygonCoords: Array<[number, number]>,
  config: GenerateConfig,
) => GenerateResult;

export const applyTerrainFollowing = core.applyTerrainFollowing as (
  geojson: WaypointCollection,
  parameters: FlightParameters,
  flightMode: FlightModeKey,
  takeoffElevation: number | null,
  threshold?: number,
) => WaypointCollection;

export const applyFlatPlacemarks = placemarks.applyFlatPlacemarks as (
  geojson: WaypointCollection,
  parameters: FlightParameters,
) => WaypointCollection;

export const buildFlightpathGeojson = placemarks.buildFlightpathGeojson as (
  placemarks: WaypointCollection,
  takeoffPoint: { lon: number; lat: number } | null,
) => FlightpathCollection;

export const DroneType = specs.DroneType as Record<DroneTypeKey, DroneTypeKey>;
export const FlightMode = specs.FlightMode as {
  WAYLINES: "waylines";
  WAYPOINTS: "waypoints";
};
export const GimbalAngle = specs.GimbalAngle as {
  OFF_NADIR: "-80";
  OBLIQUE: "-45";
  NADIR: "-90";
};
export const DRONE_SPECS = specs.DRONE_SPECS as Record<DroneTypeKey, DroneSpec>;

export const createWpml = dji.createWpml as (
  placemarks: WaypointCollection,
  globalHeight?: number,
) => string;

export const createKmz = kmz.createKmz as (wpmlXml: string) => ArrayBuffer;

export const createPotensicZip = potensic.createPotensicZip as (
  featcol: WaypointCollection,
  defaultSpeed: number,
  timestampMs?: number,
) => PotensicBundle;

export const buildZip = potensic.buildZip as (
  entries: Array<{ name: string; data: string }>,
) => ArrayBuffer;

export const GIMBAL_CHOICES: Array<{ value: GimbalAngleKey; label: string; hint: string }> = [
  { value: "-80", label: "Off-nadir (-80°)", hint: "Default. Best all-round detail for mapping." },
  { value: "-90", label: "Nadir (-90°)", hint: "Straight down. Cleanest orthophotos." },
  { value: "-45", label: "Oblique (-45°)", hint: "Angled. Better for 3D models and facades." },
];

export const DRONE_CHOICES: Array<{ value: DroneTypeKey; label: string }> = [
  { value: "DJI_MINI_4_PRO", label: "DJI Mini 4 Pro" },
  { value: "DJI_AIR_3", label: "DJI Air 3" },
  { value: "DJI_MINI_5_PRO", label: "DJI Mini 5 Pro" },
  { value: "POTENSIC_ATOM_2", label: "Potensic Atom 2" },
];

export function outputFormatFor(droneType: DroneTypeKey): "potensic" | "dji" {
  return droneType === "POTENSIC_ATOM_2" ? "potensic" : "dji";
}
