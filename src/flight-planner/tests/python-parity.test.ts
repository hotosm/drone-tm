import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { generate } from "../src/core/qfield";
import type { FlightModeKey, GenerateConfig } from "../src/core/types";

const fixtures = new URL("./fixtures/", import.meta.url);
const read = (name: string) =>
  JSON.parse(readFileSync(fileURLToPath(new URL(name, fixtures)), "utf-8"));

type RefPoint = [number, number, number, boolean];

interface RefCase {
  count: number;
  time: number;
  battery: boolean;
  stride?: number;
  pts: RefPoint[];
}

// Direct Mercator formulas differ from pyproj by less than 0.11 m.
const COORD_TOLERANCE_DEG = 1e-6;

const CASES: Record<string, GenerateConfig> = {
  "auto-waylines": { autoRotation: true, rotationAngle: 0, flightMode: "waylines" },
  "rot45-waylines": { autoRotation: false, rotationAngle: 45, flightMode: "waylines" },
  "auto-waypoints": { autoRotation: true, rotationAngle: 0, flightMode: "waypoints" },
};

const BASE: GenerateConfig = {
  gsd: 3.5,
  forwardOverlap: 75,
  sideOverlap: 75,
  droneType: "DJI_MINI_4_PRO",
  gimbalAngle: "-80",
  imageInterval: 2,
};

function ring(name: string): Array<[number, number]> {
  return read(name).features[0].geometry.coordinates[0];
}

for (const [aoiName, refName] of [
  ["aoi-small.geojson", "python-aoi-small.json"],
  ["aoi-kathmandu.geojson", "python-aoi-kathmandu.json"],
] as const) {
  describe(`${aoiName} matches drone-flightplan`, () => {
    const reference = read(refName) as Record<string, RefCase>;
    const aoi = ring(aoiName);

    for (const [caseName, config] of Object.entries(CASES)) {
      const ref = reference[caseName];
      const result = generate(aoi, {
        ...BASE,
        ...config,
        flightMode: config.flightMode as FlightModeKey,
      });
      const features = result.geojson.features;

      describe(caseName, () => {
        it("produces the same number of waypoints", () => {
          expect(features.length).toBe(ref.count);
        });

        it("estimates the same flight time", () => {
          expect(result.estimatedFlightTimeMinutes).toBeCloseTo(ref.time, 1);
        });

        it("agrees on the battery warning", () => {
          expect(result.batteryWarning).toBe(ref.battery);
        });

        it("places every waypoint where Python does", () => {
          const stride = ref.stride ?? 1;
          let worst = 0;
          let worstIndex = -1;

          ref.pts.forEach((point, i) => {
            const feature = features[i * stride];
            expect(feature, `missing waypoint ${i * stride}`).toBeDefined();
            const [lon, lat] = feature.geometry.coordinates;
            const delta = Math.max(Math.abs(lon - point[0]), Math.abs(lat - point[1]));
            if (delta > worst) {
              worst = delta;
              worstIndex = i * stride;
            }
          });

          expect(
            worst,
            `waypoint ${worstIndex} is ${(worst * 111320).toFixed(2)} m from Python's`,
          ).toBeLessThan(COORD_TOLERANCE_DEG);
        });

        it("agrees on every heading and photo flag", () => {
          const stride = ref.stride ?? 1;
          const mismatches: string[] = [];

          ref.pts.forEach((point, i) => {
            const props = features[i * stride].properties;
            if (props.heading !== point[2]) {
              mismatches.push(`${i * stride}: heading ${props.heading} vs ${point[2]}`);
            }
            if (Boolean(props.take_photo) !== point[3]) {
              mismatches.push(`${i * stride}: take_photo ${props.take_photo} vs ${point[3]}`);
            }
          });

          expect(mismatches.slice(0, 5)).toEqual([]);
        });
      });
    }
  });
}
