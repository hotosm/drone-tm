import { Polygon } from "geojson";
import { getRuntimeConfig } from "../runtimeConfig";
import { polygonCentroid } from "../utils/geometry";

const API_URL = getRuntimeConfig("VITE_API_URL", "/api");

export interface FlightPreviewTask {
  id: string;
  geometry: Polygon;
  area_m2: number;
}

export async function postFlightPreview(
  polygon: Polygon,
  cellSizeMeters = 100,
): Promise<{ tasks: FlightPreviewTask[] }> {
  const res = await fetch(`${API_URL}/public/flight-preview/`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      polygon: { type: "Feature", geometry: polygon },
      cell_size_meters: cellSizeMeters,
    }),
  });

  if (!res.ok) throw new Error(`Flight preview failed (${res.status})`);
  return res.json();
}

export function postWaypointKmz(
  geometry: Polygon,
  altitude: number,
  droneModel: string,
): Promise<Blob> {
  const formData = new FormData();
  const blob = new Blob(
    [JSON.stringify({ type: "Feature", geometry, properties: {} })],
    { type: "application/json" },
  );
  const [lng, lat] = polygonCentroid(geometry);
  formData.append("project_geojson", blob, "polygon.geojson");
  formData.append("altitude", String(altitude));
  formData.append("drone_type", droneModel);
  formData.append("download", "true");
  formData.append("take_off_point", JSON.stringify({ longitude: lng, latitude: lat }));
  return fetch(`${API_URL}/waypoint/`, { method: "POST", body: formData })
    .then(res => {
      if (!res.ok) throw new Error(`Waypoint request failed (${res.status})`);
      return res.blob();
    });
}
