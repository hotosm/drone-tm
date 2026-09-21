import { fromArrayBuffer } from "geotiff";
import { describe, expect, it } from "vitest";
import {
  BUNDLE_MARGIN_PX,
  DemSampler,
  NODATA_FLOOR,
  PIXEL_DEG,
  type Bbox,
  type DemCrop,
} from "../src/core/dem";
import { cropForBundle, writeFloat32Geotiff } from "../src/core/geotiff-write";

const WIDTH = 7;
const HEIGHT = 5;
const ORIGIN: [number, number] = [85.28, 27.72];

function crop(): DemCrop {
  const values = new Float32Array(WIDTH * HEIGHT);
  for (let i = 0; i < values.length; i++) values[i] = 1300.5 + i;
  values[9] = NODATA_FLOOR; // a void, as GLO-30 has over water
  return {
    values,
    width: WIDTH,
    height: HEIGHT,
    bbox: [
      ORIGIN[0],
      ORIGIN[1] - HEIGHT * PIXEL_DEG,
      ORIGIN[0] + WIDTH * PIXEL_DEG,
      ORIGIN[1],
    ] as Bbox,
  };
}

describe("writeFloat32Geotiff", () => {
  it("round-trips float32 samples through geotiff.js", async () => {
    const source = crop();
    const image = await (await fromArrayBuffer(writeFloat32Geotiff(source))).getImage();
    const band = (await image.readRasters({ interleave: false }))[0] as Float32Array;

    expect(image.getWidth()).toBe(WIDTH);
    expect(image.getHeight()).toBe(HEIGHT);
    expect(band.constructor.name).toBe("Float32Array");
    expect([...band]).toEqual([...source.values]);
  });

  it("keeps the georeferencing the crop was taken with", async () => {
    const source = crop();
    const image = await (await fromArrayBuffer(writeFloat32Geotiff(source))).getImage();

    for (const [index, edge] of (image.getBoundingBox() as Bbox).entries()) {
      expect(edge).toBeCloseTo(source.bbox[index], 9);
    }
    expect(image.getResolution()[0]).toBeCloseTo(PIXEL_DEG, 12);
  });

  it("declares the tags GDAL needs to read it as elevation", async () => {
    const image = await (await fromArrayBuffer(writeFloat32Geotiff(crop()))).getImage();
    const directory = image.getFileDirectory();

    expect([...directory.SampleFormat]).toEqual([3]);
    expect([...directory.BitsPerSample]).toEqual([32]);
    expect(directory.Compression).toBe(1);
    expect(directory.GDAL_NODATA).toBe(`${NODATA_FLOOR}\u0000`);
    expect(image.getGeoKeys().GeographicTypeGeoKey).toBe(4326);
  });

  it("survives a trip back through the app's own sampler", async () => {
    const source = crop();
    const sampler = await DemSampler.fromBytes(writeFloat32Geotiff(source));

    const centre: [number, number] = [
      (source.bbox[0] + source.bbox[2]) / 2,
      (source.bbox[1] + source.bbox[3]) / 2,
    ];
    expect(sampler.pixelCount).toBe(WIDTH * HEIGHT);
    expect(sampler.bounds()[0]).toBeCloseTo(source.bbox[0], 9);
    expect(sampler.sample(...centre)).toBeGreaterThan(1300);
  });

  it("writes every void as the nodata value it declares", async () => {
    const source = crop();
    source.values[0] = -32767; // a sentinel from someone else's DEM
    source.values[1] = NaN;
    source.values[2] = NODATA_FLOOR;

    const image = await (await fromArrayBuffer(writeFloat32Geotiff(source))).getImage();
    const band = (await image.readRasters({ interleave: false }))[0] as Float32Array;

    expect([band[0], band[1], band[2]]).toEqual([NODATA_FLOOR, NODATA_FLOOR, NODATA_FLOOR]);
    expect(band[3]).toBe(source.values[3]);
  });

  it("leaves real elevations below sea level alone", async () => {
    const source = crop();
    source.values[0] = -430.5; // the Dead Sea shore, not a void

    const image = await (await fromArrayBuffer(writeFloat32Geotiff(source))).getImage();
    const band = (await image.readRasters({ interleave: false }))[0] as Float32Array;

    expect(band[0]).toBeCloseTo(-430.5, 4);
  });

  it("refuses a crop with no pixels rather than writing a broken file", () => {
    expect(() =>
      writeFloat32Geotiff({ values: new Float32Array(), width: 0, height: 0, bbox: [0, 0, 1, 1] }),
    ).toThrow(/no pixels/);
  });
});

async function sampler(width: number, height: number): Promise<DemSampler> {
  const values = new Float32Array(width * height);
  for (let i = 0; i < values.length; i++) values[i] = 1200 + (i % 97);
  return DemSampler.fromBytes(
    writeFloat32Geotiff({
      values,
      width,
      height,
      bbox: [
        ORIGIN[0],
        ORIGIN[1] - height * PIXEL_DEG,
        ORIGIN[0] + width * PIXEL_DEG,
        ORIGIN[1],
      ] as Bbox,
    }),
  );
}

describe("cropForBundle", () => {
  it("cuts a project-wide DEM down to the area the plan flies", async () => {
    const dem = await sampler(1800, 1800);
    const full = 1800 * 1800 * 4;
    const area: Bbox = [ORIGIN[0] + 0.1, ORIGIN[1] - 0.11, ORIGIN[0] + 0.11, ORIGIN[1] - 0.1];

    const crop = cropForBundle(dem, area, full)!;

    expect(crop.bytes.byteLength).toBeLessThan(full / 100);
    expect(crop.bbox[0]).toBeLessThanOrEqual(area[0]);
    expect(crop.bbox[2]).toBeGreaterThanOrEqual(area[2]);
  });

  it("keeps enough margin for the turns outside the area", async () => {
    const dem = await sampler(400, 400);
    const area: Bbox = [ORIGIN[0] + 0.02, ORIGIN[1] - 0.03, ORIGIN[0] + 0.03, ORIGIN[1] - 0.02];

    const crop = cropForBundle(dem, area, 400 * 400 * 4)!;
    const margin = BUNDLE_MARGIN_PX * PIXEL_DEG;

    expect(crop.bbox[0]).toBeLessThanOrEqual(area[0] - margin);
    expect(crop.bbox[3]).toBeGreaterThanOrEqual(area[3] + margin);
  });

  it("declines when the crop would be no smaller than the DEM itself", async () => {
    const dem = await sampler(64, 64);
    const bounds = dem.bounds();

    expect(cropForBundle(dem, bounds, 64 * 64 * 4)).toBeNull();
  });

  it("produces a file the sampler can fly from on its own", async () => {
    const dem = await sampler(600, 600);
    const area: Bbox = [ORIGIN[0] + 0.05, ORIGIN[1] - 0.06, ORIGIN[0] + 0.06, ORIGIN[1] - 0.05];
    const crop = cropForBundle(dem, area, 600 * 600 * 4)!;

    const restored = await DemSampler.fromBytes(crop.bytes);
    const centre: [number, number] = [(area[0] + area[2]) / 2, (area[1] + area[3]) / 2];

    expect(restored.covers(area)).toBe(true);
    expect(restored.sample(...centre)).toBeCloseTo(dem.sample(...centre)!, 6);
  });
});
