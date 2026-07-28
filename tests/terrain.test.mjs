// Terrain (DTM) approximation: a sloped ground with a raised platform on top.
// heightAt should track the ground under the platform (not the platform), and
// heightAbove should read ~0 on the ground but the platform's full height on it
// — which is exactly what separates ground from roofs regardless of elevation.
import * as THREE from "three";
import { Terrain } from "../src/Terrain.js";

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

// Ground: a 40x40 grid tilted so y rises with x (slope from 0 to ~8 across the
// span). Dense triangulation so every terrain cell sees ground vertices.
function slopedGround(size, step, slope) {
  const positions = [];
  const idx = [];
  const cols = Math.floor(size / step) + 1;
  const vy = (gx, gz) => gx * step * slope; // height depends on x only
  for (let gz = 0; gz <= size / step; gz++) {
    for (let gx = 0; gx <= size / step; gx++) {
      positions.push(gx * step, vy(gx, gz), gz * step);
    }
  }
  for (let gz = 0; gz < size / step; gz++) {
    for (let gx = 0; gx < size / step; gx++) {
      const a = gz * cols + gx;
      const b = a + 1;
      const c = a + cols;
      const d = c + 1;
      idx.push(a, c, b, b, c, d);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

// A flat platform (roof) hovering PLATFORM_H above the ground at x≈20.
const PLATFORM_H = 5;
function platform(cx, cz, half, groundY) {
  const y = groundY + PLATFORM_H;
  const p = [
    cx - half, y, cz - half,
    cx + half, y, cz - half,
    cx + half, y, cz + half,
    cx - half, y, cz + half,
  ];
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(p, 3));
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

const SLOPE = 0.2; // y rises 0.2 per unit x
const root = new THREE.Group();
const ground = slopedGround(40, 1, SLOPE);
const groundYAt20 = 20 * SLOPE; // = 4
const plat = platform(20, 20, 3, groundYAt20);
root.add(ground, plat);
root.updateMatrixWorld(true);

const terrain = Terrain.build(root, { grid: 40, smoothPasses: 6 });

// Terrain under the platform should track the GROUND (~4), not the platform (~9).
const hUnderPlatform = terrain.heightAt(20, 20);
assert(
  Math.abs(hUnderPlatform - groundYAt20) < 1.5,
  `terrain under platform tracks ground ~${groundYAt20} (got ${hUnderPlatform.toFixed(2)})`
);

// The slope is followed: low-x terrain sits well below high-x terrain.
assert(
  terrain.heightAt(4, 20) < terrain.heightAt(36, 20) - 3,
  "terrain follows the slope (low x < high x)"
);

// Height ABOVE terrain: ~0 on open ground, ~PLATFORM_H on the platform — the
// separation that distinguishes ground from an elevated roof.
const aboveGround = terrain.heightAbove(6, 6 * SLOPE, 20);
assert(Math.abs(aboveGround) < 1.0, `open ground reads ~0 above terrain (got ${aboveGround.toFixed(2)})`);

const abovePlatform = terrain.heightAbove(20, groundYAt20 + PLATFORM_H, 20);
assert(
  abovePlatform > PLATFORM_H * 0.6,
  `platform reads clearly above terrain (got ${abovePlatform.toFixed(2)}, expect ~${PLATFORM_H})`
);

// The key win: a flat surface high on the slope (elevation ~7) is still GROUND
// (near-zero above terrain), where a global-floor datum would call it a roof.
const highGround = terrain.heightAbove(35, 35 * SLOPE, 20);
assert(
  highGround < abovePlatform,
  `high ground stays below platform in nDSM (${highGround.toFixed(2)} < ${abovePlatform.toFixed(2)})`
);

// --- morphological opening removes an occluding building bump ---
// Dense flat ground at y=0 with a hole, and a raised slab (roof) filling the
// hole so its footprint cells see ONLY roof vertices (a real building occludes
// the ground under it). Box-blur alone drags terrain up toward the roof; the
// opening (erode->dilate) must reach the ground around the base and pull the
// terrain back down, so the roof reads as clearly elevated.
function occludedRoof(size, hMin, hMax, H) {
  const pos = [];
  const idx = [];
  const quad = (a, b, c, d) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const ccx = gx + 0.5;
      const ccz = gz + 0.5;
      if (ccx >= hMin && ccx <= hMax && ccz >= hMin && ccz <= hMax) continue; // hole
      quad([gx, 0, gz], [gx + 1, 0, gz], [gx + 1, 0, gz + 1], [gx, 0, gz + 1]);
    }
  }
  // roof slab, tessellated so every interior footprint cell sees roof-height
  // vertices (a solid building occluding the ground beneath it)
  for (let gz = hMin; gz < hMax; gz++) {
    for (let gx = hMin; gx < hMax; gx++) {
      quad([gx, H, gz], [gx + 1, H, gz], [gx + 1, H, gz + 1], [gx, H, gz + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

const ROOF_H = 5;
const scene2 = new THREE.Group();
scene2.add(occludedRoof(40, 14, 26, ROOF_H)); // a WIDE roof — a small fixed window can't reach its centre
scene2.updateMatrixWorld(true);
const noFilter = Terrain.build(scene2, { maxWindow: 0, smoothPasses: 8 }); // percentile + blur only
const filtered = Terrain.build(scene2); // progressive filter (defaults)
const oH = filtered.heightAt(20, 20);
const bH = noFilter.heightAt(20, 20);
assert(oH < 2, `progressive filter reaches ground under a WIDE occluding roof (got ${oH.toFixed(2)})`);
assert(oH < bH - 1, `progressive filter beats blur-only under a wide roof (${oH.toFixed(2)} < ${bH.toFixed(2)})`);
assert(
  filtered.heightAbove(20, ROOF_H, 20) > 3,
  `wide roof reads clearly elevated (nDSM ${filtered.heightAbove(20, ROOF_H, 20).toFixed(2)})`
);

// --- broad raised ground (plateau) must be PRESERVED, not stripped ---
// A wide flat rise is genuine high terrain, not a building. If the filter
// shaved it, high landscape would read as roof — the original bug. Only the
// broad interior is tested (a sharp plateau EDGE is geometrically a cliff and
// legitimately ambiguous with a building wall).
function plateauScene(size, pMin, pMax, H) {
  const pos = [];
  const idx = [];
  const quad = (a, b, c, d) => {
    const base = pos.length / 3;
    pos.push(...a, ...b, ...c, ...d);
    idx.push(base, base + 2, base + 1, base, base + 3, base + 2);
  };
  for (let gz = 0; gz < size; gz++) {
    for (let gx = 0; gx < size; gx++) {
      const ccx = gx + 0.5;
      const ccz = gz + 0.5;
      const y = ccx >= pMin && ccx <= pMax && ccz >= pMin && ccz <= pMax ? H : 0;
      quad([gx, y, gz], [gx + 1, y, gz], [gx + 1, y, gz + 1], [gx, y, gz + 1]);
    }
  }
  const g = new THREE.BufferGeometry();
  g.setAttribute("position", new THREE.Float32BufferAttribute(pos, 3));
  g.setIndex(idx);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial());
}

const PLAT_H = 3;
const scene3 = new THREE.Group();
scene3.add(plateauScene(40, 6, 34, PLAT_H)); // 28-wide raised ground
scene3.updateMatrixWorld(true);
const terr3 = Terrain.build(scene3);
assert(
  terr3.heightAt(20, 20) > PLAT_H - 1,
  `broad plateau preserved as terrain (got ${terr3.heightAt(20, 20).toFixed(2)}, expect ~${PLAT_H})`
);
assert(
  Math.abs(terr3.heightAbove(20, PLAT_H, 20)) < 1,
  `plateau surface reads as ground, not roof (nDSM ${terr3.heightAbove(20, PLAT_H, 20).toFixed(2)})`
);

console.log("\nAll terrain tests passed.");
