import * as parameters from "@qfield/generate/parameters.js";
import type { PlanParams } from "./flightplan";
import type { FlightParameters } from "./types";

const calculateParameters = parameters.calculateParameters as (
  forwardOverlap: number,
  sideOverlap: number,
  agl: number,
  gsd: number | null,
  imageInterval?: number,
  droneType?: string,
) => FlightParameters;

export interface ParamPreview {
  altitude: number;
  sideSpacing: number;
  forwardSpacing: number;
  groundSpeed: number;
  note: string;
}

export function calculatePreview(params: PlanParams): ParamPreview {
  const computed = calculateParameters(
    params.forwardOverlap,
    params.sideOverlap,
    params.agl,
    params.useGsd ? params.gsd : null,
    params.imageInterval,
    params.droneType,
  );

  const altitude = Math.round(computed.altitude_above_ground_level);

  const note = params.useGsd
    ? `To get ${params.gsd} cm/px the drone flies at about ${altitude} m above the ground.`
    : `At ${altitude} m the photos work out at roughly ` +
      `${estimateGsd(params, computed).toFixed(1)} cm/px on the ground.`;

  return {
    altitude,
    sideSpacing: Math.round(computed.side_spacing * 10) / 10,
    forwardSpacing: Math.round(computed.forward_spacing * 10) / 10,
    groundSpeed: computed.ground_speed,
    note,
  };
}

function estimateGsd(params: PlanParams, computed: FlightParameters): number {
  // Derive the conversion constant from the shared core.
  const perCm = calculateParameters(
    params.forwardOverlap,
    params.sideOverlap,
    0,
    1,
    params.imageInterval,
    params.droneType,
  ).altitude_above_ground_level;
  if (!perCm) return 0;
  return computed.altitude_above_ground_level / perCm;
}
