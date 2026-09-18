import { describe, expect, it } from "vitest";
import {
  DemAreaError,
  MAX_DIMENSION_PX,
  PIXEL_DEG,
  bboxIncludingPoint,
  demCropUrl,
  snapBbox,
  type Bbox,
} from "../src/core/dem";

const KATHMANDU: Bbox = [85.28, 27.68, 85.32, 27.72];
const KATHMANDU_SNAPPED = [85.2798611111, 27.6798611111, 85.3201388889, 27.7201388889];
const TILE_SEAM: Bbox = [85.94, 27.6, 86.06, 27.7];
const TILE_SEAM_SNAPPED = [85.9398611111, 27.5998611111, 86.0601388889, 27.7001388889];

function onGrid(value: number): boolean {
  const edges = (value + 0.5 * PIXEL_DEG) / PIXEL_DEG;
  return Math.abs(edges - Math.round(edges)) < 1e-6;
}

const round10 = (value: number) => Number(value.toFixed(10));

describe("snapBbox", () => {
  it.each([
    ["kathmandu", KATHMANDU, KATHMANDU_SNAPPED, [145, 145]],
    ["tile seam", TILE_SEAM, TILE_SEAM_SNAPPED, [433, 361]],
  ])("reproduces the verified source grid (%s)", (_label, bbox, expected, size) => {
    const { bbox: snapped, width, height } = snapBbox(bbox as Bbox, 0);

    expect(snapped.map(round10)).toEqual(expected);
    expect([width, height]).toEqual(size);
  });

  it("lands every edge on the source grid", () => {
    const { bbox } = snapBbox([12.3456, -7.6543, 12.5432, -7.4321], 1);

    expect(bbox.every(onGrid)).toBe(true);
  });

  it("only ever grows the area", () => {
    const [minx, miny, maxx, maxy] = snapBbox(KATHMANDU).bbox;

    expect(minx).toBeLessThanOrEqual(KATHMANDU[0]);
    expect(miny).toBeLessThanOrEqual(KATHMANDU[1]);
    expect(maxx).toBeGreaterThanOrEqual(KATHMANDU[2]);
    expect(maxy).toBeGreaterThanOrEqual(KATHMANDU[3]);
  });

  it("buffers by whole pixels", () => {
    const plain = snapBbox(KATHMANDU, 0);
    const buffered = snapBbox(KATHMANDU, 1);

    expect(buffered.width).toBe(plain.width + 2);
    expect(buffered.height).toBe(plain.height + 2);
  });

  it("survives extreme coordinates", () => {
    const { bbox, width, height } = snapBbox([179.9, -89.9, 179.95, -89.85]);

    expect(bbox.every(onGrid)).toBe(true);
    expect(width).toBeGreaterThan(0);
    expect(height).toBeGreaterThan(0);
  });

  it("refuses an antimeridian-crossing aoi rather than mirroring it", () => {
    expect(() => snapBbox([-179.99, 27.6, 179.99, 27.7])).toThrow(
      new RegExp(String(MAX_DIMENSION_PX)),
    );
  });

  it("rejects a degenerate bbox", () => {
    expect(() => snapBbox([85.3, 27.7, 85.3, 27.7])).toThrow(/Degenerate bbox/);
  });

  it("rejects an aoi too large to serve", () => {
    expect(() => snapBbox([0, 0, 20, 20])).toThrow(new RegExp(String(MAX_DIMENSION_PX)));
  });

  it("attaches actionable guidance to an area error", () => {
    try {
      snapBbox([0, 0, 20, 20]);
      expect.unreachable();
    } catch (error) {
      expect(error).toBeInstanceOf(DemAreaError);
      expect((error as DemAreaError).guidance).toMatch(/split|upload/i);
    }
  });
});

describe("bboxIncludingPoint", () => {
  it("extends a crop to include takeoff", () => {
    expect(bboxIncludingPoint(KATHMANDU, { lon: 85.27, lat: 27.73 })).toEqual([
      85.27, 27.68, 85.32, 27.73,
    ]);
  });

  it("does not mutate the area bbox", () => {
    const bbox: Bbox = [...KATHMANDU];
    bboxIncludingPoint(bbox, { lon: 85.27, lat: 27.73 });
    expect(bbox).toEqual(KATHMANDU);
  });
});

describe("demCropUrl", () => {
  it("asks for a single band crop at native size", () => {
    const url = demCropUrl(TILE_SEAM);
    const { bbox, width, height } = snapBbox(TILE_SEAM);

    expect(
      url.startsWith("https://api.imagery.hotosm.org/raster/collections/cop-dem-glo-30/bbox/"),
    ).toBe(true);
    expect(url).toContain(`width=${width}&height=${height}`);
    expect(url).toContain("return_mask=false");
    expect(url).toContain("assets=data");
    expect(url).toContain(`${bbox[0].toFixed(10)},${bbox[1].toFixed(10)}`);
  });

  it("honours an overridden base url without doubling the slash", () => {
    expect(demCropUrl(KATHMANDU, "https://example.test/raster/")).toContain(
      "https://example.test/raster/collections/",
    );
  });
});
