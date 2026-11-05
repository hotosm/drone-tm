import { describe, expect, it } from "vitest";
import { buildPlan, DEFAULT_PARAMS, type PlanParams } from "../src/core/flightplan";
import type { DemSampler } from "../src/core/dem";
import { mergeNoFlyZones, parseParams, ParamsError } from "../src/core/params";

type Ring = Array<[number, number]>;

const task: Ring = [
  [85.3, 27.71],
  [85.304, 27.71],
  [85.304, 27.712],
  [85.3, 27.712],
  [85.3, 27.71],
];

// An angled zone along the north of the task, drawn past its edges
const northZone: Ring = [
  [85.299, 27.7115],
  [85.305, 27.7118],
  [85.305, 27.715],
  [85.299, 27.715],
  [85.299, 27.7115],
];

const middleZone: Ring = [
  [85.3015, 27.7105],
  [85.3025, 27.7105],
  [85.3025, 27.7115],
  [85.3015, 27.7115],
  [85.3015, 27.7105],
];

const southTakeoff = { lon: 85.302, lat: 27.7095 };

const params = (overrides: Partial<PlanParams>): PlanParams => ({
  ...DEFAULT_PARAMS,
  terrainFollow: false,
  takeoffPoint: southTakeoff,
  ...overrides,
});

function closestApproachMetres(path: Array<[number, number]>, zone: Ring): number {
  const metresPerDegree = 111_320;
  const scale = Math.cos((27.71 * Math.PI) / 180);
  const toLocal = ([lon, lat]: [number, number]) => [
    lon * scale * metresPerDegree,
    lat * metresPerDegree,
  ];
  const edge = zone.slice(0, 2).map((p) => toLocal(p));
  const [ax, ay] = edge[0];
  const [bx, by] = edge[1];
  return Math.min(
    ...path.map((point) => {
      const [x, y] = toLocal(point);
      const t = ((x - ax) * (bx - ax) + (y - ay) * (by - ay)) / ((bx - ax) ** 2 + (by - ay) ** 2);
      return Math.hypot(x - (ax + t * (bx - ax)), y - (ay + t * (by - ay)));
    }),
  );
}

describe("no-fly zones", () => {
  for (const flightMode of ["waylines", "waypoints"] as const) {
    it(`keeps ${flightMode} at least 20 m from a zone`, () => {
      const without = buildPlan(task, params({ flightMode }), null);
      const plan = buildPlan(task, params({ flightMode, noFlyZones: [northZone] }), null);

      const unfiltered = without.waypoints.features.map((f) => f.geometry.coordinates);
      const points = plan.waypoints.features.map(
        (f) => f.geometry.coordinates.slice(0, 2) as [number, number],
      );
      expect(points.length).toBeGreaterThan(0);
      expect(points.length).toBeLessThan(unfiltered.length);
      expect(closestApproachMetres(points, northZone)).toBeGreaterThanOrEqual(19.9);
    });
  }

  it("blocks a plan whose legs would cross a zone inside the task", () => {
    expect(() => buildPlan(task, params({ noFlyZones: [middleZone] }), null)).toThrow(
      /no-fly zone/,
    );
  });

  it("blocks a plan with a takeoff point inside a zone", () => {
    const takeoffPoint = { lon: 85.302, lat: 27.714 };
    expect(() => buildPlan(task, params({ noFlyZones: [northZone], takeoffPoint }), null)).toThrow(
      /no-fly zone/,
    );
  });

  it("blocks a task entirely inside a zone", () => {
    const zone: Ring = [
      [85.29, 27.7],
      [85.31, 27.7],
      [85.31, 27.72],
      [85.29, 27.72],
      [85.29, 27.7],
    ];
    expect(() => buildPlan(task, params({ noFlyZones: [zone] }), null)).toThrow(/no-fly zone/);
  });

  describe("flight home", () => {
    const areaTo = (north: number): Ring => [
      [85.3, 27.71],
      [85.304, 27.71],
      [85.304, north],
      [85.3, north],
      [85.3, 27.71],
    ];
    const area = areaTo(27.7132);
    const takeoffPoint = { lon: 85.295, lat: 27.7115 };
    const base = params({ takeoffPoint, gsd: 3.5, flightMode: "waypoints" });

    // A zone crossing only the flight home, as the path starts and ends in a V
    function zoneOnReturnLine(route: PlanParams, ring: Ring = area): Ring {
      const features = buildPlan(ring, route, null).waypoints.features;
      const end = features[features.length - 1].geometry.coordinates;
      const lon = end[0] + (takeoffPoint.lon - end[0]) * 0.2;
      const lat = end[1] + (takeoffPoint.lat - end[1]) * 0.2;
      const size = 0.00015;
      return [
        [lon - size, lat - size],
        [lon + size, lat - size],
        [lon + size, lat + size],
        [lon - size, lat + size],
        [lon - size, lat - size],
      ];
    }

    // Line spacing differs by mode, so each needs its own area to end on the west side
    for (const [flightMode, ring] of [
      ["waypoints", area],
      ["waylines", areaTo(27.713)],
    ] as const) {
      it(`adds a no-photo waypoint around a zone blocking the way home (${flightMode})`, () => {
        const route = { ...base, flightMode };
        const zone = zoneOnReturnLine(route, ring);
        const direct = buildPlan(ring, route, null).waypoints.features;

        const planned = buildPlan(ring, { ...route, noFlyZones: [zone] }, null);

        const features = planned.waypoints.features;
        expect(features.length).toBe(direct.length + 1);
        expect(features[features.length - 1].properties.take_photo).toBe(false);
      });
    }

    it("keeps that waypoint through terrain simplification", () => {
      const zone = zoneOnReturnLine(base);
      const direct = buildPlan(area, base, null).waypoints.features;
      const flat = buildPlan(area, { ...base, noFlyZones: [zone] }, null).waypoints.features;
      expect(flat.length).toBe(direct.length + 1);

      let reading = 0;
      const dem = { sample: () => 1000 + (reading++ % 40) } as unknown as DemSampler;
      const terrain = buildPlan(
        area,
        { ...base, flightMode: "waylines", noFlyZones: [zone], terrainFollow: true },
        dem,
      );

      const final = terrain.waypoints.features.at(-1)?.geometry.coordinates;
      expect(final?.slice(0, 2)).toEqual(flat.at(-1)?.geometry.coordinates.slice(0, 2));
    });

    it("warns when returning home early would cross a zone", () => {
      const zone = zoneOnReturnLine(base);
      const planned = buildPlan(area, { ...base, noFlyZones: [zone] }, null);
      expect(planned.noFlyReturnWarning).toBe(true);
    });

    it("does not warn when every return is clear", () => {
      const planned = buildPlan(task, params({ noFlyZones: [northZone] }), null);
      expect(planned.noFlyReturnWarning).toBe(false);
    });
  });

  it("requires a takeoff point when a project has zones", () => {
    const missing = params({ noFlyZones: [northZone], takeoffPoint: null });
    expect(() => buildPlan(task, missing, null)).toThrow(/takeoff point/);
  });

  it("leaves a plan unchanged without zones", () => {
    const plain = buildPlan(task, params({}), null);
    const empty = buildPlan(task, params({ noFlyZones: [] }), null);
    expect(empty.waypoints).toEqual(plain.waypoints);
  });
});

describe("parseParams no-fly zones", () => {
  it("defaults to none", () => {
    expect(parseParams({}).noFlyZones).toEqual([]);
  });

  it("keeps valid rings", () => {
    expect(parseParams({ noFlyZones: [northZone] }).noFlyZones).toEqual([northZone]);
  });

  it("rejects a malformed zone rather than ignoring it", () => {
    expect(() => parseParams({ noFlyZones: [[[85.3, "x"]]] })).toThrow(ParamsError);
  });

  it("keeps zones from both sides of a settings import, without duplicates", () => {
    const exported = JSON.parse(JSON.stringify(params({ noFlyZones: [northZone] })));
    const imported = parseParams(exported).noFlyZones;

    expect(mergeNoFlyZones([], imported)).toEqual([northZone]);
    expect(mergeNoFlyZones([northZone], imported)).toEqual([northZone]);
    expect(mergeNoFlyZones([middleZone], imported)).toEqual([middleZone, northZone]);
  });
});
