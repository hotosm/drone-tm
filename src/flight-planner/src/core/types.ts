export type Position = [number, number] | [number, number, number];

export type DroneTypeKey =
  | "DJI_MINI_4_PRO"
  | "DJI_AIR_3"
  | "DJI_MINI_5_PRO"
  | "POTENSIC_ATOM_1"
  | "POTENSIC_ATOM_2";

export type FlightModeKey = "waylines" | "waypoints";

export type GimbalAngleKey = "-80" | "-90" | "-45";

export interface WaypointProperties {
  index: number;
  heading: number;
  take_photo: boolean;
  gimbal_angle: string;
  speed?: number;
  altitude?: number;
}

export interface WaypointFeature {
  type: "Feature";
  geometry: { type: "Point"; coordinates: Position };
  properties: WaypointProperties;
}

export interface WaypointCollection {
  type: "FeatureCollection";
  features: WaypointFeature[];
}

export interface FlightpathCollection {
  type: "FeatureCollection";
  features: Array<{
    type: "Feature";
    properties: { kind: "flightpath" };
    geometry: { type: "LineString"; coordinates: Array<[number, number]> };
  }>;
}

export interface FlightParameters {
  forward_photo_height: number;
  side_photo_width: number;
  forward_spacing: number;
  side_spacing: number;
  ground_speed: number;
  altitude_above_ground_level: number;
  adjusted_max_battery_life: number;
}

export interface GenerateConfig {
  agl?: number;
  gsd?: number | null;
  forwardOverlap?: number;
  sideOverlap?: number;
  rotationAngle?: number;
  autoRotation?: boolean;
  flightMode?: FlightModeKey;
  droneType?: DroneTypeKey;
  gimbalAngle?: GimbalAngleKey;
  imageInterval?: number;
}

export interface GenerateResult {
  geojson: WaypointCollection;
  batteryWarning: boolean;
  estimatedFlightTimeMinutes: number;
  parameters: FlightParameters;
}

export interface DroneSpec {
  max_battery_life_minutes: { quoted_value: number; tested_value: number };
  sensor_height_mm: number;
  sensor_width_mm: number;
  equiv_focal_length_mm: number;
  image_width_px: number;
}

export interface PotensicBundle {
  zipData: ArrayBuffer;
  globalJson: string;
  missionJson: string;
  timestampMs: number;
}
