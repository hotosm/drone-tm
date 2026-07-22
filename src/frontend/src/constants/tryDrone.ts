// Constants for the public "Fly My Drone" flow (views/TryDrone).

// Camera / defaults
// Fallback map center [lng, lat] for a fresh start when the user's geolocation
// is denied or unavailable; on success the flow centers on the user instead.
export const INITIAL_MAP_CENTER: [number, number] = [0, 0];
export const INITIAL_MAP_ZOOM = 15;

export const DEFAULT_ALTITUDE = 70;
export const DEFAULT_GRID_DIMENSION = 200;
export const DEFAULT_AREA_KM2 = 0.16;
export const DEFAULT_DRONE_MODEL = 'DJI_MINI_4_PRO';

export const AREA_MIN_KM2 = 0.1;
export const AREA_MAX_KM2 = 1.5;

// Format a backend area (square meters) as a km² display string. The API returns
// per-task areas in m²; the UI shows them in km² to match the AOI size control.
export const formatAreaKm2 = (m2: number) => `${(m2 / 1_000_000).toFixed(2)} km²`;

// Integrations
// Glyphs are required for maplibre to render text symbol layers (grid cell labels).
export const GLYPHS_URL =
  'https://demotiles.maplibre.org/font/{fontstack}/{range}.pbf';
export const TOUR_SEEN_KEY = 'tryDroneTourSeen';
// Preview refetch is debounced because dragging / sliding updates the polygon every frame.
export const PREVIEW_DEBOUNCE_MS = 300;

// localStorage key holding the user's place in the flow (current step + input
// values) as one JSON blob, so a reload resumes where they left off.
export const STORAGE_KEY = 'tryDrone.workflow';

// Camera fit
export const FIT_PADDING_GRID = 40;
export const FIT_PADDING_FLIGHT = 105;
export const FIT_DURATION = 500;

// Map paint — magic numbers for the try-drone layers, grouped by layer.
// Colors come from @Constants/map (brandRed); these are the opacities, widths,
// and label styling specific to this flow.
export const TRY_DRONE_MAP_STYLE = {
  gridPreview: {
    fillOpacity: 0.15,
    lineWidth: 1,
  },
  task: {
    fillOpacity: 0.2,
    selectedFillOpacity: 0.45,
    lineWidth: 1,
  },
  step3Task: {
    fillOpacity: 0.2,
    lineWidth: 2,
  },
  label: {
    textSize: 12,
    textColor: '#1f2937',
    haloColor: '#ffffff',
    haloWidth: 1.5,
  },
} as const;
