import { useMutation } from "@tanstack/react-query";
import { Polygon } from "geojson";
import { postFlightPreview, FlightPreviewTask } from "@Services/tryDrone";

export const useFlightPreviewMutation = () =>
  useMutation<{ tasks: FlightPreviewTask[] }, Error, { polygon: Polygon; cellSizeMeters?: number }>({
    mutationFn: ({ polygon, cellSizeMeters }) => postFlightPreview(polygon, cellSizeMeters),
  });
