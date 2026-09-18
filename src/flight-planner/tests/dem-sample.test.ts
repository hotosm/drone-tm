import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DemSampler } from "../src/core/dem";

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
