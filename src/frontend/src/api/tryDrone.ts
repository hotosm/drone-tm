import { useMutation } from "@tanstack/react-query";
import { Polygon } from "geojson";
import {
  postFlightPreview,
  postFlightPlan,
  FlightPreviewTask,
  FlightPlanResponse,
} from "@Services/tryDrone";

export const useFlightPreviewMutation = () =>
  useMutation<{ tasks: FlightPreviewTask[] }, Error, { polygon: Polygon; cellSizeMeters?: number }>(
    {
      mutationFn: ({ polygon, cellSizeMeters }) => postFlightPreview(polygon, cellSizeMeters),
    },
  );

export const useFlightPlanMutation = () =>
  useMutation<
    FlightPlanResponse,
    Error,
    { geometry: Polygon; altitude: number; droneModel: string }
  >({
    mutationFn: ({ geometry, altitude, droneModel }) =>
      postFlightPlan(geometry, altitude, droneModel),
  });
