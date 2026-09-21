import { fromArrayBuffer, type GeoTIFFImage } from "geotiff";

// Keep grid arithmetic aligned with src/backend/app/dem/glo30.py.

export const PIXEL_DEG = 1 / 3600;
export const GRID_ORIGIN = -0.5 * PIXEL_DEG;

export const DEFAULT_BUFFER_PX = 1;

export const MAX_DIMENSION_PX = 4096;

/** Limit for automatically expanded crops to protect mobile memory. */
export const MAX_AUTO_DIMENSION_PX = 2048;

/** Buffer around a lone task when nothing tells us how big the project is. */
export const DEFAULT_RADIUS_KM = 25;

/** Buffer around a known project outline, for tasks that hug its edge. */
export const PROJECT_MARGIN_KM = 2;

/** Margin for flight-line turns and bilinear sampling. */
export const COVERAGE_MARGIN_PX = 2;

/** Slack kept around the flight area when cropping a DEM for a plan bundle. */
export const BUNDLE_MARGIN_PX = 8;

const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON_EQUATOR = 111.32;

export const RASTER_API_URL = "https://api.imagery.hotosm.org/raster";
export const DEM_STAC_COLLECTION = "cop-dem-glo-30";

// TiTiler crops omit the nodata tag, so values need an explicit threshold.
export const NODATA_FLOOR = -9999;

export type Bbox = [number, number, number, number];

export interface SnappedBbox {
  bbox: Bbox;
  width: number;
  height: number;
}

export function bboxIncludingPoint(bbox: Bbox, point: { lon: number; lat: number } | null): Bbox {
  if (!point) return [...bbox];
  return [
    Math.min(bbox[0], point.lon),
    Math.min(bbox[1], point.lat),
    Math.max(bbox[2], point.lon),
    Math.max(bbox[3], point.lat),
  ];
}

export function bboxUnion(a: Bbox, b: Bbox): Bbox {
  return [Math.min(a[0], b[0]), Math.min(a[1], b[1]), Math.max(a[2], b[2]), Math.max(a[3], b[3])];
}

export function bboxContains(outer: Bbox, inner: Bbox, marginDeg = 0): boolean {
  return (
    outer[0] <= inner[0] - marginDeg &&
    outer[1] <= inner[1] - marginDeg &&
    outer[2] >= inner[2] + marginDeg &&
    outer[3] >= inner[3] + marginDeg
  );
}

export function expandBboxKm(bbox: Bbox, km: number): Bbox {
  if (km <= 0) return [...bbox];
  const midLat = (bbox[1] + bbox[3]) / 2;
  const cosLat = Math.max(Math.cos((midLat * Math.PI) / 180), 0.02);
  const dLat = km / KM_PER_DEG_LAT;
  const dLon = km / (KM_PER_DEG_LON_EQUATOR * cosLat);
  return [
    Math.max(bbox[0] - dLon, -180),
    Math.max(bbox[1] - dLat, -90),
    Math.min(bbox[2] + dLon, 180),
    Math.min(bbox[3] + dLat, 90),
  ];
}

export function bboxSizeKm(bbox: Bbox): { widthKm: number; heightKm: number } {
  const midLat = (bbox[1] + bbox[3]) / 2;
  const cosLat = Math.max(Math.cos((midLat * Math.PI) / 180), 0.02);
  return {
    widthKm: (bbox[2] - bbox[0]) * KM_PER_DEG_LON_EQUATOR * cosLat,
    heightKm: (bbox[3] - bbox[1]) * KM_PER_DEG_LAT,
  };
}

export class DemAreaError extends Error {
  readonly guidance: string;
  constructor(message: string, guidance: string) {
    super(message);
    this.name = "DemAreaError";
    this.guidance = guidance;
  }
}

function snapDown(value: number): number {
  return GRID_ORIGIN + Math.floor((value - GRID_ORIGIN) / PIXEL_DEG) * PIXEL_DEG;
}

function snapUp(value: number): number {
  return GRID_ORIGIN + Math.ceil((value - GRID_ORIGIN) / PIXEL_DEG) * PIXEL_DEG;
}

export function snapBbox(bbox: Bbox, bufferPx: number = DEFAULT_BUFFER_PX): SnappedBbox {
  let [minx, miny, maxx, maxy] = bbox;
  if (minx >= maxx || miny >= maxy) {
    throw new DemAreaError(
      `Degenerate bbox: ${bbox.join(", ")}`,
      "Draw an area with some width and height, then try again.",
    );
  }

  const pad = bufferPx * PIXEL_DEG;
  minx = snapDown(minx - pad);
  miny = snapDown(miny - pad);
  maxx = snapUp(maxx + pad);
  maxy = snapUp(maxy + pad);

  const width = Math.round((maxx - minx) / PIXEL_DEG);
  const height = Math.round((maxy - miny) / PIXEL_DEG);

  if (width > MAX_DIMENSION_PX || height > MAX_DIMENSION_PX) {
    throw new DemAreaError(
      `This area needs a ${width} x ${height} px DEM, over the ` + `${MAX_DIMENSION_PX} px limit.`,
      "Split it into smaller areas, or upload your own DEM for this area.",
    );
  }

  return { bbox: [minx, miny, maxx, maxy], width, height };
}

export function estimateDemBytes(snapped: SnappedBbox): number {
  return snapped.width * snapped.height * 4;
}

export interface DemPlan {
  /** What to ask the service for: the flight area plus as much context as fits. */
  bbox: Bbox;
  snapped: SnappedBbox;
  bytes: number;
  /** True when the buffer had to be cut back to stay inside maxPx. */
  clamped: boolean;
  /** True when the plan covers a supplied project outline in full. */
  coversContext: boolean;
}

export interface DemPlanOptions {
  /** The area that must be covered: the flight area, and takeoff if set. */
  required: Bbox;
  /** A wider area worth having while online, normally the project outline. */
  context?: Bbox | null;
  radiusKm?: number;
  maxPx?: number;
}

/** Expands a required area toward project coverage without exceeding maxPx. */
export function planDemBbox(options: DemPlanOptions): DemPlan {
  const { required, context = null } = options;
  const maxPx = options.maxPx ?? MAX_AUTO_DIMENSION_PX;
  const radiusKm = options.radiusKm ?? (context ? PROJECT_MARGIN_KM : DEFAULT_RADIUS_KM);

  snapBbox(required);

  // Leave room for the pixel buffer and the outward snapping on both edges.
  const maxSpan = Math.max((maxPx - 2 * DEFAULT_BUFFER_PX - 2) * PIXEL_DEG, PIXEL_DEG);
  const wanted = expandBboxKm(context ? bboxUnion(required, context) : required, radiusKm);

  let clamped = false;
  const fit = (lo: number, hi: number, reqLo: number, reqHi: number): [number, number] => {
    if (hi - lo <= maxSpan) return [lo, hi];
    clamped = true;
    if (reqHi - reqLo >= maxSpan) return [reqLo, reqHi];

    const centre = (reqLo + reqHi) / 2;
    let low = centre - maxSpan / 2;
    let high = centre + maxSpan / 2;
    if (low < lo) {
      high += lo - low;
      low = lo;
    }
    if (high > hi) {
      low -= high - hi;
      high = hi;
    }
    return [Math.min(low, reqLo), Math.max(high, reqHi)];
  };

  const [minx, maxx] = fit(wanted[0], wanted[2], required[0], required[2]);
  const [miny, maxy] = fit(wanted[1], wanted[3], required[1], required[3]);

  const bbox: Bbox = [minx, miny, maxx, maxy];
  const snapped = snapBbox(bbox);
  return {
    bbox,
    snapped,
    bytes: estimateDemBytes(snapped),
    clamped,
    coversContext: context ? bboxContains(snapped.bbox, context) : false,
  };
}

export function ringBbox(ring: Array<[number, number]>): Bbox {
  let minx = Infinity;
  let miny = Infinity;
  let maxx = -Infinity;
  let maxy = -Infinity;
  for (const [lon, lat] of ring) {
    if (lon < minx) minx = lon;
    if (lon > maxx) maxx = lon;
    if (lat < miny) miny = lat;
    if (lat > maxy) maxy = lat;
  }
  return [minx, miny, maxx, maxy];
}

export function demCropUrl(bbox: Bbox, baseUrl: string = RASTER_API_URL): string {
  const { bbox: snapped, width, height } = snapBbox(bbox);
  const coords = snapped.map((v) => v.toFixed(10)).join(",");
  return (
    `${baseUrl.replace(/\/+$/, "")}` +
    `/collections/${DEM_STAC_COLLECTION}` +
    `/bbox/${coords}.tif` +
    `?assets=data&width=${width}&height=${height}&return_mask=false`
  );
}

/**
 * The raster the service returned is the grid we asked for.
 *
 * Snapping to the GLO-30 grid and passing the matching width and height is
 * what makes a browser crop pixel-identical to the backend's; a different
 * size means the two are sampling different grids, so fail rather than
 * quietly disagree about a waypoint's altitude.
 */
export function demMatchesRequest(sampler: DemSampler, snapped: SnappedBbox): boolean {
  const { width, height } = sampler.size();
  return width === snapped.width && height === snapped.height;
}

export async function fetchDem(
  bbox: Bbox,
  opts: { baseUrl?: string; signal?: AbortSignal } = {},
): Promise<{ bytes: ArrayBuffer; url: string; snapped: SnappedBbox }> {
  const snapped = snapBbox(bbox);
  const url = demCropUrl(bbox, opts.baseUrl);

  const response = await fetch(url, { signal: opts.signal });
  if (!response.ok) {
    throw new Error(
      `The elevation service returned ${response.status}. ` +
        "Check your connection and try again.",
    );
  }

  const bytes = await response.arrayBuffer();
  if (bytes.byteLength === 0) {
    throw new Error("The elevation service returned an empty DEM for this area.");
  }

  return { bytes, url, snapped };
}

export interface DemCrop {
  values: Float32Array;
  width: number;
  height: number;
  bbox: Bbox;
}

export interface DemRange {
  min: number;
  max: number;
  voids: number;
  /** Pixels examined, so a void count can be read as a proportion. */
  count: number;
}

export class DemSampler {
  private constructor(
    private readonly values: Float32Array,
    private readonly width: number,
    private readonly height: number,
    private readonly bbox: Bbox,
  ) {}

  static async fromBytes(bytes: ArrayBuffer): Promise<DemSampler> {
    const tiff = await fromArrayBuffer(bytes);
    const image: GeoTIFFImage = await tiff.getImage();
    const rasters = await image.readRasters({ interleave: false });
    const band = (rasters as unknown as Float32Array[])[0];
    if (!band) throw new Error("The DEM file has no raster bands.");

    const [minx, miny, maxx, maxy] = image.getBoundingBox() as Bbox;
    return new DemSampler(
      band instanceof Float32Array ? band : Float32Array.from(band),
      image.getWidth(),
      image.getHeight(),
      [minx, miny, maxx, maxy],
    );
  }

  get pixelCount(): number {
    return this.width * this.height;
  }

  bounds(): Bbox {
    return [...this.bbox];
  }

  size(): { width: number; height: number } {
    return { width: this.width, height: this.height };
  }

  contains(lon: number, lat: number): boolean {
    const [minx, miny, maxx, maxy] = this.bbox;
    return lon >= minx && lon <= maxx && lat >= miny && lat <= maxy;
  }

  covers(bbox: Bbox, marginDeg = COVERAGE_MARGIN_PX * PIXEL_DEG): boolean {
    return bboxContains(this.bbox, bbox, marginDeg);
  }

  private resolution(): { xres: number; yres: number } {
    const [minx, miny, maxx, maxy] = this.bbox;
    return { xres: (maxx - minx) / this.width, yres: (maxy - miny) / this.height };
  }

  private window(bbox: Bbox): { c0: number; c1: number; r0: number; r1: number } {
    const [minx, , , maxy] = this.bbox;
    const { xres, yres } = this.resolution();
    const clamp = (value: number, limit: number) => Math.min(Math.max(value, 0), limit - 1);

    const c0 = clamp(Math.floor((bbox[0] - minx) / xres), this.width);
    const c1 = clamp(Math.ceil((bbox[2] - minx) / xres) - 1, this.width);
    const r0 = clamp(Math.floor((maxy - bbox[3]) / yres), this.height);
    const r1 = clamp(Math.ceil((maxy - bbox[1]) / yres) - 1, this.height);
    return { c0, c1: Math.max(c0, c1), r0, r1: Math.max(r0, r1) };
  }

  private valueAt(col: number, row: number): number {
    const c = Math.min(Math.max(col, 0), this.width - 1);
    const r = Math.min(Math.max(row, 0), this.height - 1);
    return this.values[r * this.width + c];
  }

  /** Bilinear elevation, or null outside the raster or over a void. */
  sample(lon: number, lat: number): number | null {
    const [minx, , , maxy] = this.bbox;
    if (!this.contains(lon, lat)) return null;

    const { xres, yres } = this.resolution();

    // Convert coordinates to pixel centres; row zero is the north edge.
    const fx = (lon - minx) / xres - 0.5;
    const fy = (maxy - lat) / yres - 0.5;

    const x0 = Math.floor(fx);
    const y0 = Math.floor(fy);
    const tx = fx - x0;
    const ty = fy - y0;

    const v00 = this.valueAt(x0, y0);
    const v10 = this.valueAt(x0 + 1, y0);
    const v01 = this.valueAt(x0, y0 + 1);
    const v11 = this.valueAt(x0 + 1, y0 + 1);

    for (const v of [v00, v10, v01, v11]) {
      if (!Number.isFinite(v) || v <= NODATA_FLOOR) return null;
    }

    const top = v00 * (1 - tx) + v10 * tx;
    const bottom = v01 * (1 - tx) + v11 * tx;
    return top * (1 - ty) + bottom * ty;
  }

  /** Returns the elevation range over an optional pixel window. */
  range(window?: Bbox): DemRange {
    const { c0, c1, r0, r1 } = window
      ? this.window(window)
      : { c0: 0, c1: this.width - 1, r0: 0, r1: this.height - 1 };

    let min = Infinity;
    let max = -Infinity;
    let voids = 0;
    let count = 0;
    for (let row = r0; row <= r1; row++) {
      const offset = row * this.width;
      for (let col = c0; col <= c1; col++) {
        const v = this.values[offset + col];
        count++;
        if (!Number.isFinite(v) || v <= NODATA_FLOOR) {
          voids++;
          continue;
        }
        if (v < min) min = v;
        if (v > max) max = v;
      }
    }
    if (min === Infinity) return { min: 0, max: 0, voids, count };
    return { min, max, voids, count };
  }

  crop(bbox: Bbox): DemCrop {
    const [minx, , , maxy] = this.bbox;
    const { xres, yres } = this.resolution();
    const { c0, c1, r0, r1 } = this.window(bbox);

    const width = c1 - c0 + 1;
    const height = r1 - r0 + 1;
    const values = new Float32Array(width * height);
    for (let row = 0; row < height; row++) {
      const from = (r0 + row) * this.width + c0;
      values.set(this.values.subarray(from, from + width), row * width);
    }

    return {
      values,
      width,
      height,
      bbox: [minx + c0 * xres, maxy - (r1 + 1) * yres, minx + (c1 + 1) * xres, maxy - r0 * yres],
    };
  }
}
