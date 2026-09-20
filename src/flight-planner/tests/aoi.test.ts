import { describe, expect, it } from "vitest";
import { AoiError, formatArea, readAoiFile, ringAreaM2, validateRing } from "../src/core/aoi";

const SQUARE: Array<[number, number]> = [
  [85.28, 27.68],
  [85.32, 27.68],
  [85.32, 27.72],
  [85.28, 27.72],
  [85.28, 27.68],
];

describe("validateRing", () => {
  it("accepts a closed square", () => {
    const result = validateRing(SQUARE);

    expect(result.ring).toHaveLength(5);
    expect(result.bbox).toEqual([85.28, 27.68, 85.32, 27.72]);
  });

  it("closes an open ring", () => {
    const open = SQUARE.slice(0, 4);
    const result = validateRing(open);

    expect(result.ring).toHaveLength(5);
    expect(result.ring.at(-1)).toEqual(result.ring[0]);
  });

  it("rejects fewer than three corners", () => {
    expect(() =>
      validateRing([
        [0, 0],
        [1, 1],
      ]),
    ).toThrow(AoiError);
  });

  it("rejects projected coordinates with an explanation", () => {
    try {
      validateRing([
        [9494000, 3200000],
        [9495000, 3200000],
        [9495000, 3201000],
      ]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(AoiError);
      expect((error as AoiError).guidance).toMatch(/EPSG:4326/);
    }
  });

  it("rejects a zero-height area", () => {
    expect(() =>
      validateRing([
        [85.28, 27.68],
        [85.32, 27.68],
        [85.3, 27.68],
      ]),
    ).toThrow(/no width or height/);
  });

  it("rejects an antimeridian crossing before the DEM service has to", () => {
    expect(() =>
      validateRing([
        [-179.9, 27.6],
        [179.9, 27.6],
        [179.9, 27.7],
      ]),
    ).toThrow(/antimeridian/);
  });

  it("rejects a non-numeric coordinate", () => {
    expect(() =>
      validateRing([
        [85.28, 27.68],
        ["x", 27.68],
        [85.3, 27.7],
      ] as never),
    ).toThrow(/valid coordinate/);
  });

  it("rejects a ring with no surface", () => {
    expect(() =>
      validateRing([
        [0, 0],
        [1, 1],
        [0, 0],
      ]),
    ).toThrow(/no usable surface/);
  });

  it("rejects a self-crossing ring even when its signed area is nonzero", () => {
    expect(() =>
      validateRing([
        [0, 0],
        [4, 4],
        [0, 2],
        [3, 0],
      ]),
    ).toThrow(/edges cross/);
  });
});

describe("readAoiFile", () => {
  const file = (geometry: object) =>
    new File([JSON.stringify({ type: "Feature", properties: {}, geometry })], "area.geojson");

  it("rejects polygons with holes", async () => {
    await expect(
      readAoiFile(
        file({
          type: "Polygon",
          coordinates: [
            SQUARE,
            [
              [85.29, 27.69],
              [85.3, 27.69],
              [85.3, 27.7],
              [85.29, 27.69],
            ],
          ],
        }),
      ),
    ).rejects.toThrow(/holes/);
  });

  it("rejects multiple polygons", async () => {
    await expect(
      readAoiFile(file({ type: "MultiPolygon", coordinates: [[SQUARE], [SQUARE]] })),
    ).rejects.toThrow(/multiple flight areas/);
  });
});

describe("ringAreaM2", () => {
  it("gets a 0.04 degree square near Kathmandu about right", () => {
    const area = ringAreaM2(SQUARE);

    expect(area / 1_000_000).toBeGreaterThan(15);
    expect(area / 1_000_000).toBeLessThan(20);
  });

  it("is sign independent of winding order", () => {
    expect(ringAreaM2([...SQUARE].reverse())).toBeCloseTo(ringAreaM2(SQUARE), 0);
  });

  it("is zero for a degenerate ring", () => {
    expect(
      ringAreaM2([
        [0, 0],
        [1, 1],
      ]),
    ).toBe(0);
  });
});

describe("formatArea", () => {
  it.each([
    [500, "0.001 km²"],
    [50_000, "0.050 km²"],
    [708_000, "0.708 km²"],
    [5_000_000, "5.00 km²"],
    [150_000_000, "150.0 km²"],
  ])("formats %i m² as %s", (input, expected) => {
    expect(formatArea(input)).toBe(expected);
  });
});
