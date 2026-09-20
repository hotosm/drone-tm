import { DEFAULT_PARAMS, type PlanParams } from "./flightplan";
import { DRONE_CHOICES } from "./qfield";
import type { DroneTypeKey, FlightModeKey, GimbalAngleKey } from "./types";
import { dtmFetch } from "./http";

export class ParamsError extends Error {
  readonly guidance: string;
  constructor(message: string, guidance: string) {
    super(message);
    this.name = "ParamsError";
    this.guidance = guidance;
  }
}

const DRONE_KEYS = new Set<string>(DRONE_CHOICES.map((choice) => choice.value));
const GIMBAL_KEYS = new Set(["-80", "-90", "-45"]);
const FLIGHT_MODES = new Set(["waylines", "waypoints"]);

function num(
  raw: unknown,
  fallback: number,
  { min, max, label }: { min: number; max: number; label: string },
): number {
  if (raw === undefined || raw === null || raw === "") return fallback;
  const value = Number(raw);
  if (!Number.isFinite(value)) {
    throw new ParamsError(
      `"${label}" is not a number.`,
      "Fix the file, or fill the form in by hand.",
    );
  }
  if (value < min || value > max) {
    throw new ParamsError(
      `"${label}" is ${value}, outside the usable range ${min}-${max}.`,
      "Fix the file, or fill the form in by hand.",
    );
  }
  return value;
}

function bool(raw: unknown, fallback: boolean): boolean {
  if (typeof raw === "boolean") return raw;
  if (raw === "true") return true;
  if (raw === "false") return false;
  return fallback;
}

export function parseParams(raw: unknown): PlanParams {
  if (!raw || typeof raw !== "object") {
    throw new ParamsError(
      "That file does not contain flight parameters.",
      "Upload a params.json downloaded from this app, or fill the form in by hand.",
    );
  }
  const input = raw as Record<string, unknown>;

  const droneType = String(input.droneType ?? DEFAULT_PARAMS.droneType);
  if (!DRONE_KEYS.has(droneType)) {
    throw new ParamsError(
      `Unknown drone "${droneType}".`,
      `Supported drones: ${[...DRONE_KEYS].join(", ")}.`,
    );
  }

  const gimbalAngle = String(input.gimbalAngle ?? DEFAULT_PARAMS.gimbalAngle);
  if (!GIMBAL_KEYS.has(gimbalAngle)) {
    throw new ParamsError(`Unknown gimbal angle "${gimbalAngle}".`, "Use -80, -90 or -45.");
  }

  const flightMode = String(input.flightMode ?? DEFAULT_PARAMS.flightMode);
  if (!FLIGHT_MODES.has(flightMode)) {
    throw new ParamsError(`Unknown flight mode "${flightMode}".`, "Use waylines or waypoints.");
  }

  const takeoffRaw = input.takeoffPoint as Record<string, unknown> | null | undefined;
  let takeoffPoint: PlanParams["takeoffPoint"] = null;
  if (takeoffRaw && typeof takeoffRaw === "object") {
    const lon = Number(takeoffRaw.lon);
    const lat = Number(takeoffRaw.lat);
    if (
      Number.isFinite(lon) &&
      Number.isFinite(lat) &&
      Math.abs(lon) <= 180 &&
      Math.abs(lat) <= 90
    ) {
      takeoffPoint = { lon, lat };
    }
  }

  return {
    droneType: droneType as DroneTypeKey,
    gimbalAngle: gimbalAngle as GimbalAngleKey,
    flightMode: flightMode as FlightModeKey,
    useGsd: bool(input.useGsd, DEFAULT_PARAMS.useGsd),
    // Reject only values that can collapse flight-line spacing.
    gsd: num(input.gsd, DEFAULT_PARAMS.gsd, { min: 0.1, max: 20, label: "gsd" }),
    agl: num(input.agl, DEFAULT_PARAMS.agl, { min: 10, max: 500, label: "agl" }),
    forwardOverlap: num(input.forwardOverlap, DEFAULT_PARAMS.forwardOverlap, {
      min: 0,
      max: 99,
      label: "forwardOverlap",
    }),
    sideOverlap: num(input.sideOverlap, DEFAULT_PARAMS.sideOverlap, {
      min: 0,
      max: 99,
      label: "sideOverlap",
    }),
    autoRotation: bool(input.autoRotation, DEFAULT_PARAMS.autoRotation),
    rotationAngle: num(input.rotationAngle, DEFAULT_PARAMS.rotationAngle, {
      min: 0,
      max: 359,
      label: "rotationAngle",
    }),
    imageInterval: num(input.imageInterval, DEFAULT_PARAMS.imageInterval, {
      min: 1,
      max: 10,
      label: "imageInterval",
    }),
    terrainFollow: bool(input.terrainFollow, DEFAULT_PARAMS.terrainFollow),
    threshold: num(input.threshold, DEFAULT_PARAMS.threshold, {
      min: 1,
      max: 50,
      label: "threshold",
    }),
    takeoffPoint,
  };
}

export function paramsBlocker(params: PlanParams): string | null {
  try {
    parseParams(params);
    return null;
  } catch (error) {
    return error instanceof ParamsError ? error.message : "Check the flight settings.";
  }
}

export async function readParamsFile(file: File): Promise<PlanParams> {
  let parsed: unknown;
  try {
    parsed = JSON.parse(await file.text());
  } catch {
    throw new ParamsError(
      `"${file.name}" is not valid JSON.`,
      "Upload a params.json downloaded from this app.",
    );
  }
  return parseParams(parsed);
}

export async function fetchParams(url: string): Promise<PlanParams> {
  const response = await dtmFetch(url);
  if (!response.ok) {
    throw new ParamsError(
      `Could not load the parameters (${response.status}).`,
      response.status === 401 || response.status === 403
        ? "Sign in to DroneTM, then open this link again - or fill the form in by hand."
        : "The link may have expired. Fill the form in by hand instead.",
    );
  }
  return parseParams(await response.json());
}
