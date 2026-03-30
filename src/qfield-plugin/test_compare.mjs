/**
 * Test script: compare QField JS flightplan output against Python drone-flightplan.
 *
 * This verifies that the QField plugin's JS pipeline (geometry, parameters, grid,
 * core) produces identical waypoints to the Python backend (drone_flightplan).
 * Coordinate differences of ~0.00001° (~1m) are expected due to JS direct Mercator
 * math vs Python's pyproj EPSG:3857 transformer.
 *
 * Usage - run both scripts with the same GeoJSON and compare output side-by-side:
 *
 *   # JS pipeline (this script)
 *   node test_compare.mjs ../../ban.geojson
 *   node test_compare.mjs ../../ban2.geojson
 *
 *   # Python pipeline (companion script)
 *   python3 test_compare.py ../../ban.geojson
 *   python3 test_compare.py ../../ban2.geojson
 *
 *   # Side-by-side diff (should only show ~0.00001° coordinate diffs):
 *   diff <(node test_compare.mjs ../../ban.geojson) <(python3 test_compare.py ../../ban.geojson)
 *
 * What to compare (should match exactly between JS and Python):
 *   - Total waypoint count
 *   - Unique columns (lon) count
 *   - Forward/side spacing, ground speed, AGL
 *   - Estimated flight time and battery warning
 *   - Auto-calculated rotation angle
 *
 * Adapts the QML .pragma/.import modules to plain Node ESM by stripping QML
 * directives and evaluating via Function constructor with injected dependencies.
 */

import { readFileSync } from 'fs';
import { fileURLToPath } from 'url';
import { dirname, join } from 'path';

const __dirname = dirname(fileURLToPath(import.meta.url));

// ─── Load JS modules by stripping QML directives ───────────────────────────
function loadQmlJs(relPath) {
  const abs = join(__dirname, relPath);
  let src = readFileSync(abs, 'utf-8');
  // Remove .pragma library
  src = src.replace(/^\.pragma\s+library\s*$/m, '');
  // Remove .import lines
  src = src.replace(/^\.import\s+.+$/gm, '');
  return src;
}

// We'll build a single combined module string, then eval it in a function scope
// that provides the inter-module references (Geo, Specs, Params, Grid, Terrain).

const geoSrc = loadQmlJs('flightplan/geometry.js');
const specsSrc = loadQmlJs('flightplan/drone_specs.js');
const paramsSrc = loadQmlJs('flightplan/parameters.js');
const gridSrc = loadQmlJs('flightplan/grid.js');
const coreSrc = loadQmlJs('flightplan/core.js');

// Build each module as an object via Function constructor
function buildModule(src, deps = {}) {
  // Wrap source in a function that returns an object with all top-level vars/functions
  // We parse out function names and var names to export them.
  const funcNames = [];
  const varNames = [];
  for (const m of src.matchAll(/^function\s+(\w+)\s*\(/gm)) {
    funcNames.push(m[1]);
  }
  for (const m of src.matchAll(/^var\s+(\w+)\s*=/gm)) {
    varNames.push(m[1]);
  }

  const depNames = Object.keys(deps);
  const depValues = Object.values(deps);

  const exportList = [...funcNames, ...varNames].map(n => `${n}: typeof ${n} !== 'undefined' ? ${n} : undefined`).join(',\n  ');

  const wrapped = `
${src}
return { ${exportList} };
`;

  const fn = new Function(...depNames, wrapped);
  return fn(...depValues);
}

// Build modules in dependency order
const Geo = buildModule(geoSrc);
const Specs = buildModule(specsSrc);
const Params = buildModule(paramsSrc, { Specs });
const Grid = buildModule(gridSrc, { Geo });
const Core = buildModule(coreSrc, { Geo, Params, Grid, Specs, Terrain: {} });

// ─── Load test polygon ─────────────────────────────────────────────────────
const geojsonPath = process.argv[2];
if (!geojsonPath) {
  console.error('Usage: node test_compare.mjs <path-to-geojson>');
  console.error('  e.g. node test_compare.mjs ../../ban.geojson');
  process.exit(1);
}
const banGeojson = JSON.parse(readFileSync(join(__dirname, geojsonPath), 'utf-8'));
const polygonCoords = banGeojson.features[0].geometry.coordinates[0];

// ─── Helper: print stats for a run ─────────────────────────────────────────
function printStats(label, result) {
  const features = result.geojson.features;
  const pointCount = features.length;

  // Unique columns by rounding lon to 6 decimals
  const uniqueLons = new Set(features.map(f => f.geometry.coordinates[0].toFixed(6)));

  console.log(`\n=== ${label} ===`);
  console.log(`  Total waypoint count:  ${pointCount}`);
  console.log(`  Unique columns (lon):  ${uniqueLons.size}`);
  console.log(`  Forward spacing:       ${result.parameters.forward_spacing}`);
  console.log(`  Side spacing:          ${result.parameters.side_spacing}`);
  console.log(`  Ground speed:          ${result.parameters.ground_speed}`);
  console.log(`  AGL:                   ${result.parameters.altitude_above_ground_level}`);
  console.log(`  Est. flight time (min): ${result.estimatedFlightTimeMinutes}`);
  console.log(`  Battery warning:       ${result.batteryWarning}`);

  // Print first 3 and last 3 points for spot-checking
  console.log(`  First 3 points:`);
  for (let i = 0; i < Math.min(3, features.length); i++) {
    const c = features[i].geometry.coordinates;
    const p = features[i].properties;
    console.log(`    [${i}] lon=${c[0].toFixed(8)}, lat=${c[1].toFixed(8)}, heading=${p.heading}, take_photo=${p.take_photo}`);
  }
  console.log(`  Last 3 points:`);
  for (let i = Math.max(0, features.length - 3); i < features.length; i++) {
    const c = features[i].geometry.coordinates;
    const p = features[i].properties;
    console.log(`    [${i}] lon=${c[0].toFixed(8)}, lat=${c[1].toFixed(8)}, heading=${p.heading}, take_photo=${p.take_photo}`);
  }
}

// ─── Run 1: Auto rotation, GSD 3.5 cm/px, 75% overlap, DJI_MINI_4_PRO ────
console.log("========================================");
console.log("JS Flightplan Pipeline Comparison");
console.log("========================================");

// First show calculated parameters
const params = Params.calculateParameters(75, 75, null, 3.5, 2, "DJI_MINI_4_PRO");
console.log("\nCalculated parameters (GSD=3.5, overlap=75/75):");
console.log(`  forward_spacing: ${params.forward_spacing}`);
console.log(`  side_spacing:    ${params.side_spacing}`);
console.log(`  ground_speed:    ${params.ground_speed}`);
console.log(`  AGL:             ${params.altitude_above_ground_level}`);

// Project polygon and calculate rotation angle for reporting
const poly3857 = polygonCoords.map(c => {
  const p = Geo.toMercator(c[0], c[1]);
  return { x: p.x, y: p.y };
});
const autoAngle = Grid.calculateOptimalRotationAngle(poly3857);
console.log(`\nAuto-calculated rotation angle: ${autoAngle.toFixed(4)} degrees`);

const result1 = Core.generate(polygonCoords, {
  gsd: 3.5,
  forwardOverlap: 75,
  sideOverlap: 75,
  autoRotation: true,
  droneType: "DJI_MINI_4_PRO",
  flightMode: "waylines",
  imageInterval: 2,
});
printStats("Run 1: Auto rotation, GSD=3.5, overlap=75/75, WAYLINES", result1);

// ─── Run 2: Manual rotation=45, GSD 3.5 cm/px, 75% overlap ────────────────
const result2 = Core.generate(polygonCoords, {
  gsd: 3.5,
  forwardOverlap: 75,
  sideOverlap: 75,
  rotationAngle: 45,
  autoRotation: false,
  droneType: "DJI_MINI_4_PRO",
  flightMode: "waylines",
  imageInterval: 2,
});
printStats("Run 2: Manual rotation=45, GSD=3.5, overlap=75/75, WAYLINES", result2);

// ─── Run 3: Waypoints mode (no simplification) for counting ────────────────
const result3 = Core.generate(polygonCoords, {
  gsd: 3.5,
  forwardOverlap: 75,
  sideOverlap: 75,
  autoRotation: true,
  droneType: "DJI_MINI_4_PRO",
  flightMode: "waypoints",
  imageInterval: 2,
});
printStats("Run 3: Auto rotation, GSD=3.5, overlap=75/75, WAYPOINTS", result3);
