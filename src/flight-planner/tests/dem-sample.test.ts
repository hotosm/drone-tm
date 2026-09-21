import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { COVERAGE_MARGIN_PX, DemSampler, PIXEL_DEG, type Bbox } from "../src/core/dem";

const fixture = fileURLToPath(new URL("./fixtures/dem-kathmandu.tif", import.meta.url));

const BBOX = [85.2798611111, 27.6798611111, 85.3201388889, 27.7201388889] as const;
const CENTRE = [(BBOX[0] + BBOX[2]) / 2, (BBOX[1] + BBOX[3]) / 2] as const;

describe("DemSampler", () => {
  let sampler: DemSampler;

  beforeAll(async () => {
    const bytes = readFileSync(fixture);
    sampler = await DemSampler.fromBytes(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  });

  it("reads the crop at its native grid size", () => {
    expect(sampler.pixelCount).toBe(145 * 145);
  });

  it("returns a plausible elevation for the Kathmandu valley", () => {
    const elevation = sampler.sample(CENTRE[0], CENTRE[1]);

    expect(elevation).not.toBeNull();
    expect(elevation!).toBeGreaterThan(1200);
    expect(elevation!).toBeLessThan(2500);
  });

  it("reports a range consistent with real terrain", () => {
    const { min, max, voids } = sampler.range();

    expect(voids).toBe(0);
    expect(min).toBeGreaterThan(1000);
    expect(max).toBeGreaterThan(min);
    expect(max - min).toBeLessThan(1500);
  });

  it("returns null outside the crop rather than a wrong number", () => {
    expect(sampler.sample(0, 0)).toBeNull();
    expect(sampler.sample(BBOX[0] - 0.01, CENTRE[1])).toBeNull();
    expect(sampler.sample(CENTRE[0], BBOX[3] + 0.01)).toBeNull();
  });

  it("samples the very corners of the crop", () => {
    for (const [lon, lat] of [
      [BBOX[0], BBOX[1]],
      [BBOX[2], BBOX[3]],
      [BBOX[0], BBOX[3]],
      [BBOX[2], BBOX[1]],
    ]) {
      expect(sampler.sample(lon, lat)).not.toBeNull();
    }
  });

  it("interpolates smoothly rather than stepping between pixels", () => {
    const step = 1 / 3600 / 3;
    const a = sampler.sample(CENTRE[0], CENTRE[1])!;
    const b = sampler.sample(CENTRE[0] + step, CENTRE[1])!;

    expect(a).not.toBe(b);
    expect(Math.abs(a - b)).toBeLessThan(20);
  });

  it("varies across the crop", () => {
    const samples = [
      sampler.sample(BBOX[0] + 0.005, BBOX[1] + 0.005)!,
      sampler.sample(CENTRE[0], CENTRE[1])!,
      sampler.sample(BBOX[2] - 0.005, BBOX[3] - 0.005)!,
    ];

    expect(new Set(samples).size).toBeGreaterThan(1);
  });
});

describe("DemSampler over a window", () => {
  let sampler: DemSampler;

  const AREA: Bbox = [85.29, 27.69, 85.3, 27.7];

  beforeAll(async () => {
    const bytes = readFileSync(fixture);
    sampler = await DemSampler.fromBytes(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  });

  it("reports the raster's own shape", () => {
    expect(sampler.size()).toEqual({ width: 145, height: 145 });
    expect(sampler.bounds()[0]).toBeCloseTo(BBOX[0], 9);
  });

  it("measures height over the flight area, not the whole download", () => {
    const whole = sampler.range();
    const area = sampler.range(AREA);

    expect(area.count).toBeLessThan(whole.count);
    expect(area.min).toBeGreaterThanOrEqual(whole.min);
    expect(area.max).toBeLessThanOrEqual(whole.max);
  });

  it("counts exactly the pixels it would crop", () => {
    const crop = sampler.crop(AREA);

    expect(sampler.range(AREA).count).toBe(crop.width * crop.height);
  });

  it("crops to whole pixels that still cover the area asked for", () => {
    const crop = sampler.crop(AREA);

    expect(crop.width).toBeLessThan(145);
    expect(crop.bbox[0]).toBeLessThanOrEqual(AREA[0]);
    expect(crop.bbox[1]).toBeLessThanOrEqual(AREA[1]);
    expect(crop.bbox[2]).toBeGreaterThanOrEqual(AREA[2]);
    expect(crop.bbox[3]).toBeGreaterThanOrEqual(AREA[3]);
    expect(crop.bbox[2] - crop.bbox[0]).toBeCloseTo(crop.width * PIXEL_DEG, 9);
  });

  it("carries the same values into the crop as it reports for the window", () => {
    const crop = sampler.crop(AREA);
    const range = sampler.range(AREA);

    expect(Math.min(...crop.values)).toBeCloseTo(range.min, 6);
    expect(Math.max(...crop.values)).toBeCloseTo(range.max, 6);
  });

  it("clips a crop to the raster rather than inventing pixels", () => {
    const crop = sampler.crop([BBOX[0] - 1, BBOX[1] - 1, BBOX[2] + 1, BBOX[3] + 1]);

    expect(crop.width).toBe(145);
    expect(crop.height).toBe(145);
  });

  it("only claims to cover an area with room for the turns outside it", () => {
    const pad = COVERAGE_MARGIN_PX * PIXEL_DEG;

    expect(sampler.covers(AREA)).toBe(true);
    expect(sampler.covers([...BBOX] as Bbox)).toBe(false);
    expect(
      sampler.covers([BBOX[0] + pad, BBOX[1] + pad, BBOX[2] - pad, BBOX[3] - pad] as Bbox),
    ).toBe(true);
    expect(sampler.covers([0, 0, 1, 1])).toBe(false);
  });
});
