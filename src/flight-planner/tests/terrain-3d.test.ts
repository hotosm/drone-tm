import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { beforeAll, describe, expect, it } from "vitest";
import { DemSampler } from "../src/core/dem";
import { DEFAULT_PARAMS, buildPlan } from "../src/core/flightplan";
import { flightExtrusions, groundSampler, terrariumTile } from "../src/map/terrain";

const fixture = fileURLToPath(new URL("./fixtures/dem-kathmandu.tif", import.meta.url));

const AREA: Array<[number, number]> = [
  [85.295, 27.695],
  [85.302, 27.695],
  [85.302, 27.701],
  [85.295, 27.701],
  [85.295, 27.695],
];

// Wide enough that a fixed altitude set at the centre runs into rising ground.
const WIDE_AREA: Array<[number, number]> = [
  [85.285, 27.685],
  [85.315, 27.685],
  [85.315, 27.715],
  [85.285, 27.715],
  [85.285, 27.685],
];

function decodeTerrarium(pixels: Uint8ClampedArray, i: number): number {
  return pixels[i] * 256 + pixels[i + 1] + pixels[i + 2] / 256 - 32768;
}

function tileFor(lon: number, lat: number, z: number): { x: number; y: number } {
  const tiles = 2 ** z;
  const rad = (lat * Math.PI) / 180;
  return {
    x: Math.floor(((lon + 180) / 360) * tiles),
    y: Math.floor(((1 - Math.log(Math.tan(rad) + 1 / Math.cos(rad)) / Math.PI) / 2) * tiles),
  };
}

describe("3D terrain", () => {
  let dem: DemSampler;

  beforeAll(async () => {
    const bytes = readFileSync(fixture);
    dem = await DemSampler.fromBytes(
      bytes.buffer.slice(bytes.byteOffset, bytes.byteOffset + bytes.byteLength) as ArrayBuffer,
    );
  });

  it("encodes tiles that decode to the sampled elevation", () => {
    const ground = groundSampler(dem);
    const { x, y } = tileFor(85.3, 27.7, 13);
    const pixels = terrariumTile(ground, 13, x, y);

    expect(pixels.length).toBe(256 * 256 * 4);
    for (const i of [0, 128 * 256 + 128, 256 * 256 - 1]) {
      const elevation = decodeTerrarium(pixels, i * 4);
      expect(elevation).toBeGreaterThan(1000);
      expect(elevation).toBeLessThan(2500);
      expect(pixels[i * 4 + 3]).toBe(255);
    }
  });

  it("extends the edge of the crop instead of dropping to sea level", () => {
    const ground = groundSampler(dem);
    const [minx, miny, , maxy] = dem.bounds();
    const lat = (miny + maxy) / 2;

    expect(ground(minx - 1, lat)).toBe(dem.sample(minx, lat));
  });

  it("floats a terrain-following path at its height above ground", () => {
    const plan = buildPlan(AREA, { ...DEFAULT_PARAMS, flightMode: "waypoints" }, dem);
    const agl = plan.parameters.altitude_above_ground_level;
    const { features } = flightExtrusions(groundSampler(dem), plan.waypoints, plan.flightpath);

    const [takeoffPost, ...posts] = features.filter((f) => f.properties.kind === "post");
    expect(posts).toHaveLength(plan.waypoints.features.length);
    for (const post of posts) expect(post.properties.top).toBeCloseTo(agl, 0);
    // The climb at takeoff reaches the first waypoint's altitude.
    const firstAltitude = plan.waypoints.features[0].geometry.coordinates[2]!;
    expect(takeoffPost.properties.top).toBeCloseTo(firstAltitude, 0);

    const ribbon = features.filter((f) => f.properties.kind === "ribbon");
    expect(ribbon.length).toBeGreaterThan(posts.length);
    for (const piece of ribbon) {
      expect(piece.properties.top - piece.properties.base).toBeCloseTo(2);
      expect(piece.properties.top).toBeGreaterThan(agl * 0.5);
      expect(piece.properties.clear).toBe(true);
    }
  });

  it("puts a cube at each waypoint's altitude, carrying its details for the popup", () => {
    const plan = buildPlan(AREA, { ...DEFAULT_PARAMS, flightMode: "waypoints" }, dem);
    const agl = plan.parameters.altitude_above_ground_level;
    const { features } = flightExtrusions(groundSampler(dem), plan.waypoints, plan.flightpath);
    const caps = features.filter((f) => f.properties.kind === "cap");

    expect(caps).toHaveLength(plan.waypoints.features.length);
    const [cap] = caps;
    const [lon, lat] = plan.waypoints.features[0].geometry.coordinates;
    expect((cap.properties.base + cap.properties.top) / 2).toBeCloseTo(agl, 0);
    expect(cap.properties).toMatchObject({ lon, lat, index: 0 });
  });

  it("starts the raised route at the takeoff point", () => {
    const plan = buildPlan(AREA, DEFAULT_PARAMS, dem);
    const { features } = flightExtrusions(groundSampler(dem), plan.waypoints, plan.flightpath);
    const takeoff = plan.flightpath.features[0].geometry.coordinates[0];
    const firstPiece = features.find((f) => f.properties.kind === "ribbon")!;
    const [cornerLon, cornerLat] = firstPiece.geometry.coordinates[0][0];

    expect(cornerLon).toBeCloseTo(takeoff[0], 4);
    expect(cornerLat).toBeCloseTo(takeoff[1], 4);
  });

  it("flags a fixed-altitude leg that runs into the ground instead of lifting it", () => {
    const plan = buildPlan(WIDE_AREA, { ...DEFAULT_PARAMS, terrainFollow: false }, null);
    const { features } = flightExtrusions(groundSampler(dem), plan.waypoints, plan.flightpath);
    const blocked = features.filter((f) => f.properties.kind === "ribbon" && !f.properties.clear);

    expect(blocked.length).toBeGreaterThan(0);
    for (const piece of blocked) expect(piece.properties.top).toBe(2);
  });

  it("shows a fixed-altitude plan changing height over sloping ground", () => {
    const plan = buildPlan(AREA, { ...DEFAULT_PARAMS, terrainFollow: false }, null);
    const { features } = flightExtrusions(groundSampler(dem), plan.waypoints, plan.flightpath);
    const tops = features.filter((f) => f.properties.kind === "post").map((f) => f.properties.top);

    expect(Math.max(...tops) - Math.min(...tops)).toBeGreaterThan(5);
  });

  it("draws nothing without a takeoff point", () => {
    const plan = buildPlan(AREA, DEFAULT_PARAMS, dem);
    const empty = { type: "FeatureCollection" as const, features: [] };

    expect(flightExtrusions(groundSampler(dem), plan.waypoints, empty).features).toHaveLength(0);
  });
});
