import { FeatureCollection, Polygon } from 'geojson';
import { getRuntimeConfig } from '../runtimeConfig';
import { polygonCentroid } from '../utils/geometry';

const API_URL = getRuntimeConfig('VITE_API_URL', '/api');

export interface DroneMetadata {
  drone_type: string;
  camera_model_code: string | null;
  output_format: string;
  vertical_fov_rad: number;
  horizontal_fov_rad: number;
  gsd_to_agl_const: number;
  sensor_width_mm: number | null;
  sensor_height_mm: number | null;
  equiv_focal_length_mm: number | null;
  image_width_px: number | null;
}

export interface FlightPlanResponse extends FeatureCollection {
  drone_metadata?: DroneMetadata;
}

export interface FlightPreviewTask {
  id: string;
  geometry: Polygon;
  area_m2: number;
}

// Derived flight-plan state built by the try-drone workflow: the raw waypoints
// (as returned by the API) plus a LineString view of the same path.
export interface FlightPlanData {
  geojsonListOfPoints: FeatureCollection;
  geojsonAsLineString: FeatureCollection;
  droneMetadata?: DroneMetadata;
}

export async function postFlightPlan(
  geometry: Polygon,
  altitude: number,
  droneModel: string,
  mode: 'waylines' | 'waypoints' = 'waylines',
): Promise<FlightPlanResponse> {
  const res = await fetch(`${API_URL}/public/flight-plan/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      polygon: { type: 'Feature', geometry },
      altitude,
      drone_type: droneModel,
      mode,
    }),
  });

  if (!res.ok) throw new Error(`Flight plan failed (${res.status})`);
  return res.json();
}

export async function postFlightPreview(
  polygon: Polygon,
  cellSizeMeters = 300,
): Promise<{ tasks: FlightPreviewTask[] }> {
  const res = await fetch(`${API_URL}/public/flight-preview/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      polygon: { type: 'Feature', geometry: polygon },
      cell_size_meters: cellSizeMeters,
    }),
  });

  if (!res.ok) throw new Error(`Flight preview failed (${res.status})`);
  return res.json();
}

export async function postAllTaskFiles(
  polygon: Polygon,
  altitude: number,
  droneModel: string,
  cellSizeMeters = 300,
): Promise<{ blob: Blob; filename: string }> {
  const res = await fetch(`${API_URL}/public/all-task-files/`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      polygon: { type: 'Feature', geometry: polygon },
      altitude,
      drone_type: droneModel,
      cell_size_meters: cellSizeMeters,
    }),
  });
  if (!res.ok) throw new Error(`All task files failed (${res.status})`);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^";\n]+)"?/);
  const filename = match?.[1] ?? 'all-task-files.zip';
  return { blob: await res.blob(), filename };
}

export async function postWaypointKmz(
  geometry: Polygon,
  altitude: number,
  droneModel: string,
  taskId: string,
): Promise<{ blob: Blob; filename: string }> {
  const formData = new FormData();
  const blob = new Blob(
    [JSON.stringify({ type: 'Feature', geometry, properties: {} })],
    {
      type: 'application/json',
    },
  );
  const [lng, lat] = polygonCentroid(geometry);
  formData.append('project_geojson', blob, 'polygon.geojson');
  formData.append('altitude', String(altitude));
  formData.append('drone_type', droneModel);
  formData.append('download', 'true');
  formData.append(
    'take_off_point',
    JSON.stringify({ longitude: lng, latitude: lat }),
  );
  const res = await fetch(`${API_URL}/waypoint/`, {
    method: 'POST',
    body: formData,
  });
  if (!res.ok) throw new Error(`Waypoint request failed (${res.status})`);
  const disposition = res.headers.get('Content-Disposition') ?? '';
  const match = disposition.match(/filename="?([^";\n]+)"?/);
  const serverFilename = match?.[1] ?? '';
  const ext = serverFilename.includes('.')
    ? serverFilename.split('.').pop()
    : 'kmz';
  const filename = `flightplan-${taskId}-${droneModel}.${ext}`;
  return { blob: await res.blob(), filename };
}
