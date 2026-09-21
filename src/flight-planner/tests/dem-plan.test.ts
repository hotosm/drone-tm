import { describe, expect, it } from "vitest";
import {
  bboxContains,
  bboxSizeKm,
  bboxUnion,
  DEFAULT_RADIUS_KM,
  DemAreaError,
  expandBboxKm,
  MAX_AUTO_DIMENSION_PX,
  MAX_DIMENSION_PX,
  planDemBbox,
  type Bbox,
} from "../src/core/dem";

const LAT = 27.7;
const KM_PER_DEG_LAT = 110.574;
const KM_PER_DEG_LON = 111.32 * Math.cos((LAT * Math.PI) / 180);

function box(widthKm: number, heightKm: number): Bbox {
  const halfLon = widthKm / KM_PER_DEG_LON / 2;
  const halfLat = heightKm / KM_PER_DEG_LAT / 2;
  return [85.3 - halfLon, LAT - halfLat, 85.3 + halfLon, LAT + halfLat];
}

const MB = 1024 * 1024;

describe("expandBboxKm", () => {
  it("grows by the distance asked for, in both directions", () => {
    const grown = expandBboxKm(box(1, 1), 10);
    const { widthKm, heightKm } = bboxSizeKm(grown);

    expect(widthKm).toBeCloseTo(21, 0);
    expect(heightKm).toBeCloseTo(21, 0);
  });

  it("allows for longitude crowding away from the equator", () => {
    const tropical = expandBboxKm([0, 0, 0.01, 0.01], 10);
    const arctic = expandBboxKm([0, 70, 0.01, 70.01], 10);

    expect(arctic[2] - arctic[0]).toBeGreaterThan(tropical[2] - tropical[0]);
  });

  it("stays on the globe rather than wrapping past a pole", () => {
    const polar = expandBboxKm([179.5, 89.5, 179.9, 89.9], 200);

    expect(polar[3]).toBeLessThanOrEqual(90);
    expect(polar[2]).toBeLessThanOrEqual(180);
  });

  it("leaves a bbox alone when there is nothing to add", () => {
    expect(expandBboxKm(box(2, 2), 0)).toEqual(box(2, 2));
  });
});

describe("planDemBbox", () => {
  it("covers a whole 20 km2 project for well under a megabyte", () => {
    const task = box(0.5, 0.4);
    const project = box(5, 4);
    const plan = planDemBbox({ required: task, context: project });

    expect(plan.coversContext).toBe(true);
    expect(plan.clamped).toBe(false);
    expect(plan.bytes).toBeLessThan(MB);
  });

  it("covers a 100 km2 city project for a couple of megabytes", () => {
    const plan = planDemBbox({ required: box(0.5, 0.5), context: box(10, 10) });

    expect(plan.coversContext).toBe(true);
    expect(plan.bytes).toBeLessThan(2 * MB);
  });

  it("buys a 50 km box around a lone task, which is tens of megabytes at most", () => {
    const plan = planDemBbox({ required: box(0.5, 0.4) });
    const { widthKm, heightKm } = bboxSizeKm(plan.snapped.bbox);

    // The radius is added to each side of the task, so the box is a little over.
    expect(widthKm).toBeGreaterThan(2 * DEFAULT_RADIUS_KM);
    expect(widthKm).toBeLessThan(2 * DEFAULT_RADIUS_KM + 2);
    expect(heightKm).toBeGreaterThan(2 * DEFAULT_RADIUS_KM);
    expect(plan.bytes).toBeGreaterThan(5 * MB);
    expect(plan.bytes).toBeLessThan(20 * MB);
  });

  it("always contains the area it was asked to cover", () => {
    const cases: Array<[Bbox, Bbox | null]> = [
      [box(0.5, 0.5), null],
      [box(0.5, 0.5), box(8, 6)],
      [box(2, 2), box(400, 400)],
      [box(60, 0.5), null],
    ];

    for (const [required, context] of cases) {
      const plan = planDemBbox({ required, context });
      expect(bboxContains(plan.snapped.bbox, required)).toBe(true);
    }
  });

  it("clamps a project too big to hold in one crop, rather than refusing it", () => {
    const required = box(1, 1);
    const plan = planDemBbox({ required, context: box(400, 400) });

    expect(plan.clamped).toBe(true);
    expect(plan.coversContext).toBe(false);
    expect(plan.snapped.width).toBeLessThanOrEqual(MAX_AUTO_DIMENSION_PX);
    expect(plan.snapped.height).toBeLessThanOrEqual(MAX_AUTO_DIMENSION_PX);
    expect(bboxContains(plan.snapped.bbox, required)).toBe(true);
  });

  it("clamps each axis on its own, so a road corridor still gets its terrain", () => {
    const corridor = box(60, 0.5);
    const plan = planDemBbox({ required: corridor });

    expect(plan.clamped).toBe(true);
    expect(bboxContains(plan.snapped.bbox, corridor)).toBe(true);
    expect(plan.snapped.width).toBeGreaterThan(MAX_AUTO_DIMENSION_PX);
    expect(plan.snapped.width).toBeLessThanOrEqual(MAX_DIMENSION_PX);
    expect(plan.snapped.height).toBeLessThanOrEqual(MAX_AUTO_DIMENSION_PX);
  });

  it("keeps the buffer centred on the flight area at a project's edge", () => {
    const required = box(1, 1);
    const project = bboxUnion(required, box(400, 400));
    const plan = planDemBbox({ required, context: project });
    const centre = (plan.snapped.bbox[0] + plan.snapped.bbox[2]) / 2;

    expect(centre).toBeCloseTo((required[0] + required[2]) / 2, 2);
  });

  it("refuses an area that cannot be served at any buffer", () => {
    expect(() => planDemBbox({ required: [0, 0, 20, 20] })).toThrow(DemAreaError);
  });

  it("honours an explicit radius and ceiling", () => {
    const plan = planDemBbox({ required: box(0.5, 0.5), radiusKm: 5, maxPx: 512 });

    expect(bboxSizeKm(plan.snapped.bbox).widthKm).toBeCloseTo(10.5, 0.5);
    expect(plan.snapped.width).toBeLessThanOrEqual(512);
  });
});
