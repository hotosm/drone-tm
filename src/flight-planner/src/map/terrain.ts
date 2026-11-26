// 3D terrain from the plan's own DEM, so the 3D view works offline and shows
// exactly the surface the waypoint altitudes were computed against.
import maplibregl, { type IControl, type Map as MlMap } from "maplibre-gl";
import type { DemSampler } from "../core/dem";
import type { FlightpathCollection, WaypointCollection, WaypointProperties } from "../core/types";

export const DEM_PROTOCOL = "plan-dem";
export const DEM_TILE_SIZE = 256;
// GLO-30 pixels are finer than z12 tiles away from the equator; MapLibre overzooms past z13.
export const DEM_MAX_ZOOM = 13;

const TERRARIUM_OFFSET = 32768;
const RIBBON_PIECE_M = 10;
const RIBBON_WIDTH_M = 4;
const RIBBON_THICKNESS_M = 2;
// Wider than the ribbon, so a leg through the ground is visible when zoomed out.
const BLOCKED_WIDTH_M = 16;
const POST_WIDTH_M = 1;
const CAP_SIZE_M = 6;
const METRES_PER_DEG_LAT = 111_320;

type LonLat = [number, number];

/**
 * Ground elevation that never fails: positions outside the crop take the
 * nearest edge value, so the terrain has no cliff where the DEM ends.
 */
export function groundSampler(dem: DemSampler): (lon: number, lat: number) => number {
  const [minx, miny, maxx, maxy] = dem.bounds();
  const voidElevation = dem.range().min;
  return (lon, lat) => {
    const x = Math.min(Math.max(lon, minx), maxx);
    const y = Math.min(Math.max(lat, miny), maxy);
    return dem.sample(x, y) ?? voidElevation;
  };
}

/** RGBA pixels of one Terrarium-encoded web mercator tile. */
export function terrariumTile(
  ground: (lon: number, lat: number) => number,
  z: number,
  x: number,
  y: number,
  size = DEM_TILE_SIZE,
): Uint8ClampedArray<ArrayBuffer> {
  const tiles = 2 ** z;
  const pixels = new Uint8ClampedArray(size * size * 4);
  const lons = Array.from(
    { length: size },
    (_, px) => ((x + (px + 0.5) / size) / tiles) * 360 - 180,
  );

  for (let py = 0; py < size; py++) {
    const mercY = Math.PI * (1 - (2 * (y + (py + 0.5) / size)) / tiles);
    const lat = (Math.atan(Math.sinh(mercY)) * 180) / Math.PI;
    for (let px = 0; px < size; px++) {
      const value = ground(lons[px], lat) + TERRARIUM_OFFSET;
      const whole = Math.floor(value);
      const i = (py * size + px) * 4;
      pixels[i] = whole >> 8;
      pixels[i + 1] = whole & 0xff;
      pixels[i + 2] = Math.floor((value - whole) * 256);
      pixels[i + 3] = 255;
    }
  }
  return pixels;
}

function metresPerDegLon(lat: number): number {
  return METRES_PER_DEG_LAT * Math.cos((lat * Math.PI) / 180);
}

function lerp(a: LonLat, b: LonLat, t: number): LonLat {
  return [a[0] + (b[0] - a[0]) * t, a[1] + (b[1] - a[1]) * t];
}

/** A closed ring for a strip of the given width along a to b. */
function strip(a: LonLat, b: LonLat, width: number): LonLat[] {
  const kx = metresPerDegLon((a[1] + b[1]) / 2);
  const dx = (b[0] - a[0]) * kx;
  const dy = (b[1] - a[1]) * METRES_PER_DEG_LAT;
  const length = Math.hypot(dx, dy) || 1;
  const ox = ((-dy / length) * width) / 2 / kx;
  const oy = ((dx / length) * width) / 2 / METRES_PER_DEG_LAT;
  return [
    [a[0] + ox, a[1] + oy],
    [b[0] + ox, b[1] + oy],
    [b[0] - ox, b[1] - oy],
    [a[0] - ox, a[1] - oy],
    [a[0] + ox, a[1] + oy],
  ];
}

interface ExtrusionDetail extends Partial<WaypointProperties> {
  clear?: boolean;
  lon?: number;
  lat?: number;
}

function extrusion(
  kind: "ribbon" | "post" | "cap",
  ring: LonLat[],
  base: number,
  top: number,
  detail: ExtrusionDetail = {},
) {
  return {
    type: "Feature" as const,
    properties: { kind, base, top, clear: true, ...detail },
    geometry: { type: "Polygon" as const, coordinates: [ring] },
  };
}

/**
 * Extrusions that float the flightpath at its planned altitude.
 *
 * MapLibre places an extrusion relative to the terrain under its centroid,
 * so the path is cut into short pieces, each with its own height above ground.
 * Waypoint altitudes are relative to the takeoff point, the first path vertex.
 * Pieces at or below the ground are marked not `clear` and drawn on the surface.
 */
export function flightExtrusions(
  ground: (lon: number, lat: number) => number,
  waypoints: WaypointCollection,
  path: FlightpathCollection,
) {
  const takeoff = path.features[0]?.geometry.coordinates[0];
  if (!takeoff) return { type: "FeatureCollection" as const, features: [] };
  const takeoffElevation = ground(takeoff[0], takeoff[1]);

  const points = waypoints.features.map((feature) => {
    const [lon, lat, altitude = 0] = feature.geometry.coordinates;
    return { at: [lon, lat] as LonLat, elevation: takeoffElevation + altitude };
  });
  if (points.length === 0) return { type: "FeatureCollection" as const, features: [] };
  // DJI's "safely" mode climbs vertically to the first waypoint's altitude, then flies level.
  points.unshift({ at: [takeoff[0], takeoff[1]], elevation: points[0].elevation });

  const features = points.map(({ at, elevation }) => {
    const top = Math.max(elevation - ground(at[0], at[1]), 0);
    const half = POST_WIDTH_M / 2 / METRES_PER_DEG_LAT;
    const south: LonLat = [at[0], at[1] - half];
    const north: LonLat = [at[0], at[1] + half];
    return extrusion("post", strip(south, north, POST_WIDTH_M), 0, top);
  });

  for (let i = 1; i < points.length; i++) {
    const from = points[i - 1];
    const to = points[i];
    const kx = metresPerDegLon(from.at[1]);
    const lengthM = Math.hypot(
      (to.at[0] - from.at[0]) * kx,
      (to.at[1] - from.at[1]) * METRES_PER_DEG_LAT,
    );
    const pieces = Math.max(1, Math.ceil(lengthM / RIBBON_PIECE_M));
    for (let p = 0; p < pieces; p++) {
      const middle = lerp(from.at, to.at, (p + 0.5) / pieces);
      const elevation = from.elevation + (to.elevation - from.elevation) * ((p + 0.5) / pieces);
      const clearance = elevation - ground(middle[0], middle[1]);
      const clear = clearance > 0;
      const top = clear ? clearance : RIBBON_THICKNESS_M;
      const start = lerp(from.at, to.at, p / pieces);
      const end = lerp(from.at, to.at, (p + 1) / pieces);
      const ring = strip(start, end, clear ? RIBBON_WIDTH_M : BLOCKED_WIDTH_M);
      features.push(extrusion("ribbon", ring, top - RIBBON_THICKNESS_M, top, { clear }));
    }
  }

  // Circles cannot leave the ground, so waypoints get a small cube at their altitude.
  for (const { geometry, properties } of waypoints.features) {
    const [lon, lat] = geometry.coordinates;
    const clearance = takeoffElevation + (geometry.coordinates[2] ?? 0) - ground(lon, lat);
    const half = CAP_SIZE_M / 2;
    const south: LonLat = [lon, lat - half / METRES_PER_DEG_LAT];
    const north: LonLat = [lon, lat + half / METRES_PER_DEG_LAT];
    const ring = strip(south, north, CAP_SIZE_M);
    const top = Math.max(clearance + half, CAP_SIZE_M);
    features.push(extrusion("cap", ring, top - CAP_SIZE_M, top, { ...properties, lon, lat }));
  }

  return { type: "FeatureCollection" as const, features };
}

async function encodePng(
  pixels: Uint8ClampedArray<ArrayBuffer>,
  size: number,
): Promise<ArrayBuffer> {
  const canvas = new OffscreenCanvas(size, size);
  canvas.getContext("2d")!.putImageData(new ImageData(pixels, size, size), 0, 0);
  // PNG is lossless, so the encoded heights survive the round trip.
  const blob = await canvas.convertToBlob({ type: "image/png" });
  return blob.arrayBuffer();
}

/** Serves `plan-dem://{version}/{z}/{x}/{y}` tiles from whichever DEM is current. */
export function registerDemProtocol(current: () => DemSampler | null): void {
  let cached: { dem: DemSampler; ground: (lon: number, lat: number) => number } | null = null;

  maplibregl.addProtocol(DEM_PROTOCOL, async (params) => {
    const dem = current();
    if (!dem) throw new Error("No terrain is loaded.");
    if (cached?.dem !== dem) cached = { dem, ground: groundSampler(dem) };

    const [z, x, y] = params.url.split("/").slice(-3).map(Number);
    const pixels = terrariumTile(cached.ground, z, x, y);
    return { data: await encodePng(pixels, DEM_TILE_SIZE) };
  });
}

export class Terrain3dToggle implements IControl {
  private container = document.createElement("div");
  private button = document.createElement("button");

  constructor(private readonly onToggle: (on: boolean) => void) {}

  onAdd(): HTMLElement {
    this.button.type = "button";
    this.button.className = "terrain-toggle";
    this.button.title = "3D terrain view";
    this.button.setAttribute("aria-label", "3D terrain view");
    this.button.textContent = "3D";
    this.setState({ available: false, on: false });
    this.button.addEventListener("click", () => {
      this.onToggle(this.button.getAttribute("aria-pressed") !== "true");
    });
    this.container.className = "maplibregl-ctrl maplibregl-ctrl-group";
    this.container.append(this.button);
    return this.container;
  }

  setState({ available, on }: { available: boolean; on: boolean }): void {
    this.container.hidden = !available;
    this.button.setAttribute("aria-pressed", String(on));
  }

  onRemove(_map?: MlMap): void {
    this.container.remove();
  }
}
