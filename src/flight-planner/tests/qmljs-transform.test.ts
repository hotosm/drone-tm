import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { transformQmlJs } from "../plugins/vite-plugin-qmljs";

const pluginDir = fileURLToPath(new URL("../../qfield-plugin/", import.meta.url));

const EXPECTED: Record<string, string[]> = {
  "generate/geometry.js": ["toMercator", "toWgs84", "distance", "rotatePoint"],
  "generate/drone_specs.js": [
    "DroneType",
    "FlightMode",
    "GimbalAngle",
    "DRONE_SPECS",
    "DRONE_PARAMS",
  ],
  "generate/parameters.js": ["calculateParameters", "calculateAdjustedBatteryLife"],
  "generate/grid.js": ["generateGridInAoi", "createPath", "removeMiddlePoints"],
  "generate/terrain.js": ["createPlacemarks", "waypoints2waylines"],
  "generate/core.js": ["generate", "applyTerrainFollowing"],
  "generate/placemarks.js": ["applyFlatPlacemarks", "buildFlightpathGeojson"],
  "output/dji.js": ["createWpml"],
  "output/kmz.js": ["createKmz"],
  "output/potensic_v2.js": ["createPotensicZip", "createGlobalJson", "buildZip"],
};

function exportedNames(source: string): Set<string> {
  const names = new Set<string>();
  for (const match of source.matchAll(/^export (?:function|var) (\w+)/gm)) {
    names.add(match[1]);
  }
  return names;
}

describe("transformQmlJs", () => {
  it.each(Object.entries(EXPECTED))("exports what the app needs from %s", (file, expected) => {
    const transformed = transformQmlJs(readFileSync(pluginDir + file, "utf-8"));
    const names = exportedNames(transformed);

    for (const symbol of expected) {
      expect(names, `${file} should export ${symbol}`).toContain(symbol);
    }
  });

  it("leaves no QML directives behind", () => {
    for (const file of Object.keys(EXPECTED)) {
      const transformed = transformQmlJs(readFileSync(pluginDir + file, "utf-8"));

      expect(transformed, file).not.toMatch(/^\.pragma/m);
      expect(transformed, file).not.toMatch(/^\.import/m);
    }
  });

  it("rewrites .import into a relative namespace import", () => {
    const transformed = transformQmlJs('.pragma library\n.import "geometry.js" as Geo\n');

    expect(transformed).toContain('import * as Geo from "./geometry.js";');
  });

  it("leaves indented declarations as locals", () => {
    const transformed = transformQmlJs("function outer() {\n  var inner = 1;\n}\n");

    expect(transformed).toContain("export function outer(");
    expect(transformed).toContain("  var inner = 1;");
    expect(transformed).not.toContain("export var inner");
  });

  it("preserves line numbering so stack traces stay usable", () => {
    const source = ".pragma library\n\nfunction a() {}\nvar b = 2;\n";
    const transformed = transformQmlJs(source);

    expect(transformed.split("\n").length).toBe(source.split("\n").length);
  });
});
