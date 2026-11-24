import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DemSampler } from "../src/core/dem";
import { DEFAULT_PARAMS, areaCentre, buildPlan, type PlanParams } from "../src/core/flightplan";
import { createPotensicEveJson } from "../src/core/qfield";
import { parseParams, potensicAppForDrone } from "../src/core/params";
import { buildOutputs } from "../src/core/outputs";
import type { PlanMeta } from "../src/core/storage";

const fixtures = new URL("./fixtures/", import.meta.url);

function ring(name: string): Array<[number, number]> {
  const doc = JSON.parse(readFileSync(fileURLToPath(new URL(name, fixtures)), "utf-8"));
  return doc.features[0].geometry.coordinates[0];
}

const SMALL: Array<[number, number]> = [
  [85.295, 27.695],
  [85.302, 27.695],
  [85.302, 27.701],
  [85.295, 27.701],
  [85.295, 27.695],
];

const meta: PlanMeta = {
  id: "test-plan",
  name: "Test plan",
  createdAt: "2026-01-01T00:00:00.000Z",
  updatedAt: "2026-01-01T00:00:00.000Z",
};

const params = (overrides: Partial<PlanParams> = {}): PlanParams => ({
  ...DEFAULT_PARAMS,
  ...overrides,
});

describe("buildPlan", () => {
  let dem: DemSampler;

  beforeAll(async () => {
    const bytes = readFileSync(fileURLToPath(new URL("dem-kathmandu.tif", fixtures)));
    dem = await DemSampler.fromBytes(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  });

  it("produces a flat plan when there is no DEM", () => {
    const result = buildPlan(SMALL, params({ terrainFollow: false }), null);

    expect(result.terrainFollowing).toBe(false);
    expect(result.waypoints.features.length).toBeGreaterThan(10);

    const agl = result.parameters.altitude_above_ground_level;
    for (const feature of result.waypoints.features) {
      expect(feature.geometry.coordinates[2]).toBe(agl);
      expect(feature.properties.altitude).toBe(agl);
      expect(feature.properties.speed).toBe(result.parameters.ground_speed);
    }
  });

  it("varies altitude across sloping ground when terrain following", () => {
    const result = buildPlan(SMALL, params(), dem);

    expect(result.terrainFollowing).toBe(true);
    expect(result.sampled?.missing).toBe(0);
    expect(result.sampled?.ok).toBeGreaterThan(0);

    const altitudes = result.waypoints.features.map((f) => f.geometry.coordinates[2] as number);
    expect(new Set(altitudes).size).toBeGreaterThan(1);
  });

  it("keeps terrain-following altitudes within a sane band of the target", () => {
    const result = buildPlan(SMALL, params(), dem);
    const target = result.parameters.altitude_above_ground_level;
    const altitudes = result.waypoints.features.map((f) => f.geometry.coordinates[2] as number);

    for (const altitude of altitudes) {
      expect(altitude).toBeGreaterThan(target - 400);
      expect(altitude).toBeLessThan(target + 400);
    }
  });

  it("simplifies to fewer waypoints in waylines mode than waypoints mode", () => {
    const waypoints = buildPlan(SMALL, params({ flightMode: "waypoints" }), dem);
    const waylines = buildPlan(SMALL, params({ flightMode: "waylines" }), dem);

    expect(waylines.waypoints.features.length).toBeLessThan(waypoints.waypoints.features.length);
  });

  it("counts the same photos in waylines mode as in waypoints mode", () => {
    const waypoints = buildPlan(SMALL, params({ flightMode: "waypoints" }), dem);
    const terrain = buildPlan(SMALL, params({ flightMode: "waylines" }), dem);
    const flat = buildPlan(SMALL, params({ flightMode: "waylines", terrainFollow: false }), null);

    expect(waypoints.photos).toBeGreaterThan(0);
    expect(terrain.photos).toBe(waypoints.photos);
    expect(flat.photos).toBe(waypoints.photos);
  });

  it("re-indexes waypoints sequentially after simplification", () => {
    const result = buildPlan(SMALL, params(), dem);

    result.waypoints.features.forEach((feature, index) => {
      expect(feature.properties.index).toBe(index);
    });
  });

  it("puts the takeoff point first in the flight path", () => {
    const takeoffPoint = { lon: 85.2955, lat: 27.6955 };
    const result = buildPlan(SMALL, params({ takeoffPoint }), dem);
    const line = result.flightpath.features[0].geometry.coordinates;

    expect(line[0]).toEqual([takeoffPoint.lon, takeoffPoint.lat]);
    expect(line.length).toBe(result.waypoints.features.length + 1);
  });

  it("takes off from the middle of the area when none is set", () => {
    const result = buildPlan(SMALL, params(), dem);
    const line = result.flightpath.features[0].geometry.coordinates;
    const centre = areaCentre(SMALL);

    expect(line[0]).toEqual([centre.lon, centre.lat]);
    expect(line.length).toBe(result.waypoints.features.length + 1);
  });

  it("finds the middle of an area", () => {
    const square: Array<[number, number]> = [
      [85, 27],
      [85.01, 27],
      [85.01, 27.01],
      [85, 27.01],
      [85, 27],
    ];
    expect(areaCentre(square).lon).toBeCloseTo(85.005, 6);
    expect(areaCentre(square).lat).toBeCloseTo(27.005, 4);
  });

  it("warns about the battery on an area too big for one flight", () => {
    const result = buildPlan(ring("aoi-kathmandu.geojson"), params({ terrainFollow: false }), null);

    expect(result.batteryWarning).toBe(true);
    expect(result.estimatedFlightTimeMinutes).toBeGreaterThan(30);
  });

  it("flies higher and faster at a coarser GSD", () => {
    const fine = buildPlan(SMALL, params({ gsd: 2, terrainFollow: false }), null);
    const coarse = buildPlan(SMALL, params({ gsd: 6, terrainFollow: false }), null);

    expect(coarse.parameters.altitude_above_ground_level).toBeGreaterThan(
      fine.parameters.altitude_above_ground_level,
    );
    expect(coarse.waypoints.features.length).toBeLessThan(fine.waypoints.features.length);
  });
});

describe("buildOutputs", () => {
  it("gives a DJI drone a KMZ, a WPML and the two GeoJSONs", () => {
    const result = buildPlan(SMALL, params({ terrainFollow: false }), null);
    const files = buildOutputs(result, params({ terrainFollow: false }), meta);

    expect(files.map((f) => f.name.split(".").pop())).toEqual([
      "kmz",
      "wpml",
      "geojson",
      "geojson",
    ]);
    const kmz = new Uint8Array(files[0].data as ArrayBuffer);
    expect([...kmz.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(files[1].data as string).toContain("<wpml:waylineId>");
  });

  it("gives a Potensic Atom 2 a ZIP instead", () => {
    const potensic = params({ droneType: "POTENSIC_ATOM_2", terrainFollow: false });
    const result = buildPlan(SMALL, potensic, null);
    const files = buildOutputs(result, potensic, meta);

    expect(files[0].name).toMatch(/_potensic\.zip$/);
    const zip = new Uint8Array(files[0].data as ArrayBuffer);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("names files after the task when the plan came from a DroneTM handoff", () => {
    const result = buildPlan(SMALL, params({ terrainFollow: false }), null);
    const files = buildOutputs(result, params({ terrainFollow: false }), {
      ...meta,
      taskId: "42",
    });

    expect(files[0].name).toMatch(/^task_42_/);
  });

  it("writes all Eve fields and preserves real waypoint values and photo actions", () => {
    const eve = params({
      droneType: "POTENSIC_ATOM_2",
      potensicApp: "eve",
      flightMode: "waypoints",
      terrainFollow: false,
    });
    const result = buildPlan(SMALL, eve, null);
    const files = buildOutputs(result, eve, meta);
    expect(files[0].name).toBe("waypoints.json");
    expect(files[0].mime).toBe("application/json");

    const waypoints = JSON.parse(files[0].data as string) as Array<Record<string, unknown>>;
    expect(Object.keys(waypoints[0]!)).toEqual([
      "global_speed", "snapshootFile", "wp_speed", "wp_speed_type", "wp_yaw_custom",
      "wp_gimbal_type", "wp_yaw_type", "wp_hover_time", "wp_action", "wp_zoom_type",
      "wp_height", "wp_yaw_interest", "isHaveAltitude", "wp_zoom_ratio", "isFromSave",
      "wp_gimbal_pitch_custom", "wp_lon", "wp_lat", "wp_altitude", "addPointWay",
    ]);
    expect(waypoints[0].global_speed).toBe(result.parameters.ground_speed);
    expect(waypoints[0].snapshootFile).toBe("");

    const photoIndex = result.waypoints.features.findIndex((feature) => feature.properties.take_photo);
    expect(photoIndex).toBeGreaterThanOrEqual(0);
    const source = result.waypoints.features[photoIndex]!;
    const exported = waypoints[photoIndex]!;
    const coordinates = source.geometry.coordinates;
    expect(exported.wp_lon).toBe(Number(coordinates[0].toFixed(7)));
    expect(exported.wp_lat).toBe(Number(coordinates[1].toFixed(7)));
    expect(exported.wp_height).toBe(Math.round(Number(coordinates[2]) * 10) / 10);
    expect(exported.wp_action).toBe(1);
    expect(exported.wp_gimbal_pitch_custom).toBe(Number(source.properties.gimbal_angle));
  });

  it("keeps the Android Atom 2 ZIP output unchanged when Android is selected", () => {
    const android = params({ droneType: "POTENSIC_ATOM_2", potensicApp: "android", terrainFollow: false });
    const result = buildPlan(SMALL, android, null);
    const files = buildOutputs(result, android, meta);
    expect(files[0].name).toMatch(/_potensic\.zip$/);
    const zip = new Uint8Array(files[0].data as ArrayBuffer);
    expect([...zip.slice(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]);
  });

  it("blocks the Eve mission download above 200 waypoints", () => {
    const eve = params({ droneType: "POTENSIC_ATOM_2", potensicApp: "eve", terrainFollow: false });
    const result = buildPlan(SMALL, eve, null);
    const first = result.waypoints.features[0]!;
    const oversized = {
      ...result,
      waypoints: {
        ...result.waypoints,
        features: Array.from({ length: 201 }, () => first),
      },
    };
    const files = buildOutputs(oversized, eve, meta);
    expect(files[0].disabled).toBe(true);
    expect(files[0].hint).toMatch(/download disabled/i);
  });

  it("rejects Eve speeds outside the inclusive 0.1 to 30 m/s range", () => {
    const eve = params({ droneType: "POTENSIC_ATOM_2", potensicApp: "eve", terrainFollow: false });
    const result = buildPlan(SMALL, eve, null);
    expect(() => createPotensicEveJson(result.waypoints, 0)).toThrow(/0\.1 to 30 m\/s/);
    expect(() => createPotensicEveJson(result.waypoints, 30.1)).toThrow(/0\.1 to 30 m\/s/);
    expect(() => createPotensicEveJson(result.waypoints, 0.1)).not.toThrow();
    expect(() => createPotensicEveJson(result.waypoints, 30)).not.toThrow();
  });
});

describe("potensicAppForDrone", () => {
  it("keeps the Eve choice only for the Atom 2", () => {
    expect(potensicAppForDrone("POTENSIC_ATOM_2", "eve")).toBe("eve");
    expect(potensicAppForDrone("POTENSIC_ATOM_2", "android")).toBe("android");
    expect(potensicAppForDrone("DJI_MINI_4_PRO", "eve")).toBe("android");
    expect(potensicAppForDrone("POTENSIC_ATOM_1", "eve")).toBe("android");
  });

  it("parseParams accepts Eve for the Atom 2 and rejects unknown apps", () => {
    const eve = parseParams({ droneType: "POTENSIC_ATOM_2", potensicApp: "eve" });
    expect(eve.potensicApp).toBe("eve");
    const android = parseParams({ droneType: "DJI_MINI_4_PRO", potensicApp: "eve" });
    expect(android.potensicApp).toBe("android");
    expect(() => parseParams({ droneType: "POTENSIC_ATOM_2", potensicApp: "desktop" })).toThrow(
      /Unknown Potensic app/,
    );
  });
});
