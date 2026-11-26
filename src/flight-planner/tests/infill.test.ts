import { describe, expect, it } from "vitest";
import type { DemSampler } from "../src/core/dem";
import { buildPlan, DEFAULT_PARAMS } from "../src/core/flightplan";
import {
  buildInfillPlan,
  estimateAglM,
  INFILL_SPEED_MS,
  InfillError,
  type InfillOptions,
} from "../src/core/infill";
import { buildOutputs } from "../src/core/outputs";
import type { PhotoInfo } from "../src/core/photos";

const LON0 = 85.3;
const LAT0 = 27.7;
const M_PER_DEG_LAT = 111_320;
const M_PER_DEG_LON = M_PER_DEG_LAT * Math.cos((LAT0 * Math.PI) / 180);

const at = (x: number, y: number): [number, number] => [
  LON0 + x / M_PER_DEG_LON,
  LAT0 + y / M_PER_DEG_LAT,
];

/** Ground rising 1 m for every metre east, or a hole to the west. */
const SLOPE = {
  sample: (lon: number) => (lon < LON0 ? null : (lon - LON0) * M_PER_DEG_LON),
} as unknown as DemSampler;

const [takeoffLon, takeoffLat] = at(100, 0);
const OPTIONS: InfillOptions = {
  gimbalAngle: "-80",
  dem: SLOPE,
  aglM: 100,
  takeoff: { lon: takeoffLon, lat: takeoffLat },
};

type Plan = ReturnType<typeof buildInfillPlan>;
type Waypoint = Plan["waypoints"]["features"][number];

function photoPoints(plan: Plan): Waypoint[] {
  return plan.waypoints.features.filter((f) => f.properties.take_photo);
}

function groundXy(feature: Waypoint): [number, number] {
  return [feature.geometry.coordinates[0], feature.geometry.coordinates[1]];
}

describe("buildInfillPlan", () => {
  it("flies from takeoff to the nearest gap next, entering each from its closer end", () => {
    const east = { missed: [at(60, 30), at(120, 30)] };
    const middle = { missed: [at(50, 30), at(40, 30)] };
    const west = { missed: [at(30, 30), at(0, 30)] };
    const plan = buildInfillPlan([middle, east, west], OPTIONS);
    const route = photoPoints(plan).map((f) => f.geometry.coordinates.slice(0, 2));
    const xs = [120, 60, 50, 40, 30, 0];
    expect(route).toEqual(xs.map((x) => at(x, 30)));
  });

  it("takes a photo at each missed point and nowhere else", () => {
    const missed = [at(60, 30), at(30, 30)];
    const plan = buildInfillPlan([{ missed }], OPTIONS);
    expect(photoPoints(plan).map((f) => f.geometry.coordinates.slice(0, 2))).toEqual(missed);
    for (const { properties } of photoPoints(plan)) {
      expect(properties).toMatchObject({ gimbal_angle: "-80", speed: INFILL_SPEED_MS });
    }
  });

  it("flies to exactly the missed points, plus takeoff at each end", () => {
    const gaps = [{ missed: [at(60, 30), at(30, 30)] }, { missed: [at(200, 90)] }];
    const plan = buildInfillPlan(gaps, OPTIONS);
    const route = plan.waypoints.features.map(groundXy);
    const home = at(100, 0);
    expect(route).toEqual([home, at(60, 30), at(30, 30), at(200, 90), home]);
  });

  it("starts and ends at flight height above takeoff", () => {
    const plan = buildInfillPlan([{ missed: [at(30, 30)] }], OPTIONS);
    const { features } = plan.waypoints;
    for (const end of [features[0], features[features.length - 1]]) {
      expect(end.geometry.coordinates).toEqual([takeoffLon, takeoffLat, OPTIONS.aglM]);
    }
  });
  it("follows the ground, measured from the takeoff point", () => {
    const run = { missed: [at(30, 30), at(170, 30), at(200, 30)] };
    const plan = buildInfillPlan([run], OPTIONS);
    const heights = photoPoints(plan).map((f) => f.geometry.coordinates[2] as number);
    expect(heights[0]).toBeCloseTo(30, 6);
    expect(heights[1]).toBeCloseTo(170, 6);
    expect(heights[2]).toBeCloseTo(200, 6);
  });

  it("matches the planner's heights for the same points and takeoff", () => {
    const ring = [at(0, 0), at(200, 0), at(200, 200), at(0, 200), at(0, 0)];
    const params = {
      ...DEFAULT_PARAMS,
      flightMode: "waypoints" as const,
      useGsd: false,
      agl: OPTIONS.aglM,
      takeoffPoint: OPTIONS.takeoff,
    };
    const planned = buildPlan(ring, params, SLOPE).waypoints.features.slice(0, 5);
    const missed = planned.map(groundXy);
    const infill = photoPoints(buildInfillPlan([{ missed }], OPTIONS));
    // Infill may fly the run in the other direction.
    expect(infill).toHaveLength(planned.length);
    expect(infill.map((f) => f.geometry.coordinates)).toEqual(
      expect.arrayContaining(planned.map((f) => f.geometry.coordinates)),
    );
  });

  it("refuses a point the terrain data does not cover", () => {
    expect(() => buildInfillPlan([{ missed: [at(-30, 30)] }], OPTIONS)).toThrow(InfillError);
  });

  it("refuses a takeoff point the terrain data does not cover", () => {
    const [lon, lat] = at(-30, 0);
    const options = { ...OPTIONS, takeoff: { lon, lat } };
    expect(() => buildInfillPlan([{ missed: [at(30, 30)] }], options)).toThrow(InfillError);
  });

  it("starts the flight path at the takeoff point", () => {
    const plan = buildInfillPlan([{ missed: [at(30, 30)] }], OPTIONS);
    const [start] = plan.flightpath.features[0].geometry.coordinates;
    expect(start).toEqual([takeoffLon, takeoffLat]);
  });

  it("heads along the route, keeping the last heading at the end", () => {
    const [lon, lat] = at(0, 30);
    const options = { ...OPTIONS, takeoff: { lon, lat } };
    const plan = buildInfillPlan([{ missed: [at(30, 30), at(60, 30)] }], options);
    // East out from takeoff and along the run, then west back to takeoff.
    const headings = plan.waypoints.features.map((f) => f.properties.heading);
    expect(headings.map(Math.round)).toEqual([90, 90, -90, -90]);
  });

  it("writes a DJI mission that takes the photos itself", () => {
    const plan = buildInfillPlan([{ missed: [at(30, 30)] }], OPTIONS);
    const now = new Date().toISOString();
    const meta = {
      id: "",
      name: "task 1 infill",
      createdAt: now,
      updatedAt: now,
    };
    const files = buildOutputs(plan, { droneType: "DJI_MINI_4_PRO" }, meta);
    const wpml = files.find((f) => f.name.endsWith(".wpml"))!;
    expect(wpml.data).toContain("takePhoto");
  });
});

describe("estimateAglM", () => {
  // On SLOPE, ground height equals metres east, so a takeoff at x=100 sits at 100 m.
  const [lon, lat] = at(100, 0);
  const takeoff = { lon, lat };

  function photoAt(x: number, heightM: number | null): PhotoInfo {
    const [photoLon, photoLat] = at(x, 30);
    const base = { name: "", yawDeg: 0, focal35mm: 24, aspect: 4 / 3, takenAt: "" };
    return { ...base, lon: photoLon, lat: photoLat, heightM };
  }

  it("recovers the flight height of a terrain-following flight", () => {
    // 100 m above ground at x, minus the 100 m takeoff ground, records a height of x.
    const photos = [20, 80, 150, 190].map((x) => photoAt(x, x));
    expect(estimateAglM(photos, SLOPE, takeoff)).toBe(100);
  });

  it("ignores a stray photo taken on the climb", () => {
    const photos = [20, 80, 150, 190].map((x) => photoAt(x, x));
    expect(estimateAglM([...photos, photoAt(100, 5)], SLOPE, takeoff)).toBe(100);
  });

  it("gives nothing without photo heights or terrain at takeoff", () => {
    expect(estimateAglM([photoAt(50, null)], SLOPE, takeoff)).toBeNull();
    const [westLon, westLat] = at(-30, 0);
    const offMap = { lon: westLon, lat: westLat };
    expect(estimateAglM([photoAt(50, 50)], SLOPE, offMap)).toBeNull();
  });
});
