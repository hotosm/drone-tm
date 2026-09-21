import { readFileSync, writeFileSync, existsSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { DEFAULT_PARAMS, buildPlan, type PlanParams } from "../src/core/flightplan";

const goldenPath = fileURLToPath(new URL("./fixtures/golden-plans.json", import.meta.url));
const fixtures = new URL("./fixtures/", import.meta.url);

function ring(name: string): Array<[number, number]> {
  const doc = JSON.parse(readFileSync(fileURLToPath(new URL(name, fixtures)), "utf-8"));
  return doc.features[0].geometry.coordinates[0];
}

interface Case {
  name: string;
  aoi: string;
  params: Partial<PlanParams>;
}

const CASES: Case[] = [
  {
    name: "kathmandu-auto-waylines",
    aoi: "aoi-kathmandu.geojson",
    params: { terrainFollow: false },
  },
  {
    name: "small-auto-waylines",
    aoi: "aoi-small.geojson",
    params: { terrainFollow: false },
  },
  {
    name: "small-fixed-rotation-45",
    aoi: "aoi-small.geojson",
    params: { terrainFollow: false, autoRotation: false, rotationAngle: 45 },
  },
  {
    name: "small-waypoints-mode",
    aoi: "aoi-small.geojson",
    params: { terrainFollow: false, flightMode: "waypoints" },
  },
  {
    name: "small-explicit-agl",
    aoi: "aoi-small.geojson",
    params: { terrainFollow: false, useGsd: false, agl: 120 },
  },
  {
    name: "small-potensic",
    aoi: "aoi-small.geojson",
    params: { terrainFollow: false, droneType: "POTENSIC_ATOM_2" },
  },
];

function summarise(kase: Case) {
  const result = buildPlan(ring(kase.aoi), { ...DEFAULT_PARAMS, ...kase.params }, null);
  const features = result.waypoints.features;
  const first = features[0];
  const last = features.at(-1)!;

  return {
    waypointCount: features.length,
    photoCount: features.filter((f) => f.properties.take_photo).length,
    parameters: result.parameters,
    batteryWarning: result.batteryWarning,
    estimatedFlightTimeMinutes: result.estimatedFlightTimeMinutes,
    firstWaypoint: first.geometry.coordinates.map((v) => Number(v.toFixed(7))),
    lastWaypoint: last.geometry.coordinates.map((v) => Number(v.toFixed(7))),
    firstHeading: first.properties.heading,
    lastHeading: last.properties.heading,
  };
}

const current = Object.fromEntries(CASES.map((kase) => [kase.name, summarise(kase)]));

if (process.env.GOLDEN_UPDATE === "1") {
  writeFileSync(goldenPath, `${JSON.stringify(current, null, 2)}\n`);
}

describe("flightplan goldens", () => {
  it("has a golden file", () => {
    expect(existsSync(goldenPath), "run GOLDEN_UPDATE=1 pnpm test to create it").toBe(true);
  });

  const golden = existsSync(goldenPath)
    ? (JSON.parse(readFileSync(goldenPath, "utf-8")) as Record<string, unknown>)
    : {};

  it.each(CASES.map((kase) => kase.name))("%s is unchanged", (name) => {
    expect(current[name]).toEqual(golden[name]);
  });

  it("covers every golden entry, so a stale case cannot linger", () => {
    expect(Object.keys(golden).sort()).toEqual(CASES.map((c) => c.name).sort());
  });
});

describe("parameter-level agreement with drone-flightplan", () => {
  it("matches Python on spacing, speed and altitude", () => {
    // gsd pinned: these are Python's numbers at 3.5, not whatever the app
    // currently defaults to.
    const result = buildPlan(
      ring("aoi-kathmandu.geojson"),
      { ...DEFAULT_PARAMS, terrainFollow: false, useGsd: true, gsd: 3.5 },
      null,
    );

    expect(result.parameters.forward_spacing).toBe(24.21);
    expect(result.parameters.side_spacing).toBe(30.57);
    expect(result.parameters.ground_speed).toBe(11.5);
    expect(result.parameters.altitude_above_ground_level).toBe(97.825);
  });
});
