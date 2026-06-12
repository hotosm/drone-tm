import { useMutation } from "@tanstack/react-query";
import { FeatureCollection, Polygon } from "geojson";
import { postFlightPreview, postFlightPlan, FlightPreviewTask } from "@Services/tryDrone";

export const useFlightPreviewMutation = () =>
  useMutation<{ tasks: FlightPreviewTask[] }, Error, { polygon: Polygon; cellSizeMeters?: number }>(
    {
      mutationFn: ({ polygon, cellSizeMeters }) => postFlightPreview(polygon, cellSizeMeters),
    },
  );

export const useFlightPlanMutation = () =>
  useMutation<
    FeatureCollection,
    Error,
    { geometry: Polygon; altitude: number; droneModel: string }
  >({
    mutationFn: ({ geometry, altitude, droneModel }) =>
      postFlightPlan(geometry, altitude, droneModel),
  });
