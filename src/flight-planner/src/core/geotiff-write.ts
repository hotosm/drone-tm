import {
  BUNDLE_MARGIN_PX,
  NODATA_FLOOR,
  PIXEL_DEG,
  type Bbox,
  type DemCrop,
  type DemSampler,
} from "./dem";

// Minimal uncompressed float32 GeoTIFF writer; geotiff.js writes array data as 8-bit.

const BYTE_ORDER_LE = 0x4949;
const MAGIC = 42;

const enum Type {
  ASCII = 2,
  SHORT = 3,
  LONG = 4,
  DOUBLE = 12,
}

const TYPE_SIZE: Record<Type, number> = {
  [Type.ASCII]: 1,
  [Type.SHORT]: 2,
  [Type.LONG]: 4,
  [Type.DOUBLE]: 8,
};

interface Entry {
  tag: number;
  type: Type;
  values: number[];
}

const align = (offset: number, to: number) => Math.ceil(offset / to) * to;

function asciiBytes(text: string): number[] {
  return [...text].map((char) => char.charCodeAt(0) & 0x7f).concat(0);
}

export function writeFloat32Geotiff(crop: DemCrop): ArrayBuffer {
  const { values, width, height, bbox } = crop;
  if (width <= 0 || height <= 0 || values.length !== width * height) {
    throw new Error("Cannot write a DEM crop with no pixels.");
  }

  const [minx, miny, maxx, maxy] = bbox;
  const xres = (maxx - minx) / width;
  const yres = (maxy - miny) / height;

  // Tags must be written in ascending order, so keep this list sorted.
  const entries: Entry[] = [
    { tag: 256, type: Type.LONG, values: [width] }, // ImageWidth
    { tag: 257, type: Type.LONG, values: [height] }, // ImageLength
    { tag: 258, type: Type.SHORT, values: [32] }, // BitsPerSample
    { tag: 259, type: Type.SHORT, values: [1] }, // Compression: none
    { tag: 262, type: Type.SHORT, values: [1] }, // Photometric: BlackIsZero
    { tag: 273, type: Type.LONG, values: [0] }, // StripOffsets, patched below
    { tag: 277, type: Type.SHORT, values: [1] }, // SamplesPerPixel
    { tag: 278, type: Type.LONG, values: [height] }, // RowsPerStrip: one strip
    { tag: 279, type: Type.LONG, values: [values.byteLength] }, // StripByteCounts
    { tag: 284, type: Type.SHORT, values: [1] }, // PlanarConfiguration: chunky
    { tag: 339, type: Type.SHORT, values: [3] }, // SampleFormat: IEEE float
    { tag: 33550, type: Type.DOUBLE, values: [xres, yres, 0] }, // ModelPixelScale
    { tag: 33922, type: Type.DOUBLE, values: [0, 0, 0, minx, maxy, 0] }, // ModelTiepoint
    {
      tag: 34735, // GeoKeyDirectory: geographic WGS84, pixel-is-area
      type: Type.SHORT,
      values: [1, 1, 0, 3, 1024, 0, 1, 2, 1025, 0, 1, 1, 2048, 0, 1, 4326],
    },
    { tag: 42113, type: Type.ASCII, values: asciiBytes(String(NODATA_FLOOR)) }, // GDAL_NODATA
  ];

  const ifdOffset = 8;
  const ifdSize = 2 + entries.length * 12 + 4;

  // Anything wider than the 4-byte value field lives after the directory.
  let cursor = align(ifdOffset + ifdSize, 8);
  const overflow = new Map<number, number>();
  for (const entry of entries) {
    const size = entry.values.length * TYPE_SIZE[entry.type];
    if (size <= 4) continue;
    cursor = align(cursor, TYPE_SIZE[entry.type] === 8 ? 8 : 2);
    overflow.set(entry.tag, cursor);
    cursor += size;
  }

  const stripOffset = align(cursor, 8);
  const total = stripOffset + values.byteLength;

  const buffer = new ArrayBuffer(total);
  const view = new DataView(buffer);

  view.setUint16(0, BYTE_ORDER_LE, true);
  view.setUint16(2, MAGIC, true);
  view.setUint32(4, ifdOffset, true);
  view.setUint16(ifdOffset, entries.length, true);
  view.setUint32(ifdOffset + 2 + entries.length * 12, 0, true); // no second IFD

  const writeValues = (type: Type, at: number, list: number[]): void => {
    for (const [index, value] of list.entries()) {
      const to = at + index * TYPE_SIZE[type];
      if (type === Type.ASCII) view.setUint8(to, value);
      else if (type === Type.SHORT) view.setUint16(to, value, true);
      else if (type === Type.LONG) view.setUint32(to, value, true);
      else view.setFloat64(to, value, true);
    }
  };

  for (const [index, entry] of entries.entries()) {
    const at = ifdOffset + 2 + index * 12;
    const list = entry.tag === 273 ? [stripOffset] : entry.values;

    view.setUint16(at, entry.tag, true);
    view.setUint16(at + 2, entry.type, true);
    view.setUint32(at + 4, list.length, true);

    const size = list.length * TYPE_SIZE[entry.type];
    if (size <= 4) writeValues(entry.type, at + 8, list);
    else {
      const to = overflow.get(entry.tag)!;
      view.setUint32(at + 8, to, true);
      writeValues(entry.type, to, list);
    }
  }

  // Normalize voids to the declared nodata value.
  const strip = new Float32Array(buffer, stripOffset, values.length);
  for (let i = 0; i < values.length; i++) {
    const value = values[i];
    strip[i] = Number.isFinite(value) && value > NODATA_FLOOR ? value : NODATA_FLOOR;
  }

  return buffer;
}

export interface BundleCrop {
  bytes: ArrayBuffer;
  bbox: Bbox;
  width: number;
  height: number;
}

/** Creates the terrain crop archived with a plan. */
export function cropForBundle(
  sampler: DemSampler,
  required: Bbox,
  fullByteLength: number,
): BundleCrop | null {
  const margin = BUNDLE_MARGIN_PX * PIXEL_DEG;
  const crop = sampler.crop([
    required[0] - margin,
    required[1] - margin,
    required[2] + margin,
    required[3] + margin,
  ]);

  const bytes = writeFloat32Geotiff(crop);
  if (bytes.byteLength >= fullByteLength) return null;
  return { bytes, bbox: crop.bbox, width: crop.width, height: crop.height };
}
