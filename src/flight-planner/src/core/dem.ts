import { fromArrayBuffer, type GeoTIFFImage } from "geotiff";

// Keep grid arithmetic aligned with src/backend/app/dem/glo30.py.

export const PIXEL_DEG = 1 / 3600;
export const GRID_ORIGIN = -0.5 * PIXEL_DEG;

export const DEFAULT_BUFFER_PX = 1;

export const MAX_DIMENSION_PX = 4096;

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

  contains(lon: number, lat: number): boolean {
    const [minx, miny, maxx, maxy] = this.bbox;
    return lon >= minx && lon <= maxx && lat >= miny && lat <= maxy;
  }

  private valueAt(col: number, row: number): number {
    const c = Math.min(Math.max(col, 0), this.width - 1);
    const r = Math.min(Math.max(row, 0), this.height - 1);
    return this.values[r * this.width + c];
  }

  /** Bilinear elevation, or null outside the raster or over a void. */
  sample(lon: number, lat: number): number | null {
    const [minx, miny, maxx, maxy] = this.bbox;
    if (!this.contains(lon, lat)) return null;

    const xres = (maxx - minx) / this.width;
    const yres = (maxy - miny) / this.height;

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

  range(): { min: number; max: number; voids: number } {
    let min = Infinity;
    let max = -Infinity;
    let voids = 0;
    for (const v of this.values) {
      if (!Number.isFinite(v) || v <= NODATA_FLOOR) {
        voids++;
        continue;
      }
      if (v < min) min = v;
      if (v > max) max = v;
    }
    if (min === Infinity) return { min: 0, max: 0, voids };
    return { min, max, voids };
  }
}
