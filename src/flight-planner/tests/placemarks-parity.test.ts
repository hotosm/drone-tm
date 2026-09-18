import { execFileSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformQmlJs } from "../plugins/vite-plugin-qmljs";

const repoRoot = fileURLToPath(new URL("../../../", import.meta.url));
const pluginDir = fileURLToPath(new URL("../../qfield-plugin/", import.meta.url));

function preMoveMainQml(): string | null {
  try {
    const revs = execFileSync("git", ["log", "--format=%H", "--", "src/qfield-plugin/main.qml"], {
      cwd: repoRoot,
      encoding: "utf-8",
    })
      .trim()
      .split("\n");

    for (const rev of revs) {
      const source = execFileSync("git", ["show", `${rev}:src/qfield-plugin/main.qml`], {
        cwd: repoRoot,
        encoding: "utf-8",
        maxBuffer: 8 * 1024 * 1024,
      });
      if (source.includes("var agl = parameters.altitude_above_ground_level")) return source;
    }
  } catch {
    return null;
  }
  return null;
}

function extractFunction(source: string, name: string): string {
  const start = source.indexOf(`  function ${name}(`);
  if (start < 0) throw new Error(`not found: ${name}`);
  let depth = 0;
  let end = -1;
  for (let i = source.indexOf("{", start); i < source.length; i++) {
    if (source[i] === "{") depth++;
    else if (source[i] === "}" && --depth === 0) {
      end = i + 1;
      break;
    }
  }
  return source.slice(start, end).replace(`function ${name}`, "function impl");
}

const params = { altitude_above_ground_level: 115, ground_speed: 11.5 };

const makePlan = () => ({
  type: "FeatureCollection",
  features: [
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [85.3, 27.7] },
      properties: { index: 0, heading: 90 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [85.31, 27.71, 42] },
      properties: { index: 1, heading: 90 },
    },
    {
      type: "Feature",
      geometry: { type: "Point", coordinates: [85.32, 27.72, -5.5] },
      properties: { index: 2, heading: -90 },
    },
  ],
});

const oldMain = preMoveMainQml();

describe.skipIf(oldMain === null)("placemarks.js matches the pre-move main.qml", () => {
  const shared = new Function(
    `${transformQmlJs(readFileSync(pluginDir + "generate/placemarks.js", "utf-8")).replace(
      /^export /gm,
      "",
    )}; return { applyFlatPlacemarks, buildFlightpathGeojson };`,
  )() as {
    applyFlatPlacemarks: (plan: unknown, p: unknown) => unknown;
    buildFlightpathGeojson: (plan: unknown, takeoff: unknown) => unknown;
  };

  const oldFlat = new Function(
    `${extractFunction(oldMain!, "applyFlatPlacemarks")}; return impl;`,
  )() as (plan: unknown, p: unknown) => unknown;

  const oldPath = new Function(
    `${extractFunction(oldMain!, "_buildFlightpathGeojson")}; return impl;`,
  )() as (plan: unknown, takeoff: unknown) => unknown;

  it("applyFlatPlacemarks is unchanged", () => {
    expect(shared.applyFlatPlacemarks(makePlan(), params)).toEqual(oldFlat(makePlan(), params));
  });

  it("applyFlatPlacemarks is unchanged for an empty plan", () => {
    const empty = () => ({ type: "FeatureCollection", features: [] });

    expect(shared.applyFlatPlacemarks(empty(), params)).toEqual(oldFlat(empty(), params));
  });

  it.each([
    ["no takeoff", null],
    ["undefined takeoff", undefined],
    ["a takeoff point", { lon: 85.29, lat: 27.69 }],
    ["a partial takeoff", { lon: 85.29 }],
    ["an empty object", {}],
  ])("buildFlightpathGeojson is unchanged with %s", (_label, takeoff) => {
    const plan = oldFlat(makePlan(), params);

    expect(shared.buildFlightpathGeojson(plan, takeoff)).toEqual(oldPath(plan, takeoff));
  });
});
