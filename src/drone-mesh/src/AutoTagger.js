import * as THREE from "three";
import { worldArea } from "./Labels.js";
import { Terrain } from "./Terrain.js";

// Tier-0 auto-tagging: segment the whole mesh into coherent surface regions
// using the same flood fill as manual selection, classify each region with
// geometric priors (normal class + height above site) plus a colour check
// for vegetation, and store them as "flagged" (red) proposals. Humans then
// verify in review mode — the verify-don't-paint workflow.
//
// Results persist through LabelManager like any other label (that IS the
// cache: one run, restored on every reload). Re-run after detection tweaks
// by clearing source==="auto" labels first.

const MIN_FACES = 4; // regions smaller than this are noise (tree fragments)
const MIN_AREA = 0.25; // scene units² — filters slivers that pass the face gate
const MAX_AUTO_LABELS = 400; // draw-call / storage sanity cap
const COLOR_SAMPLE_FACES = 40;

function regionMeanColor(selector, selected) {
  let r = 0;
  let g = 0;
  let b = 0;
  let n = 0;
  outer: for (const [mesh, faces] of selected) {
    for (const f of faces) {
      const c = selector.faceColor(mesh, f);
      if (c) {
        r += c[0];
        g += c[1];
        b += c[2];
        n++;
      }
      if (n >= COLOR_SAMPLE_FACES) break outer;
    }
  }
  return n ? [r / n, g / n, b / n] : null;
}

function isGreenish(c) {
  return c && c[1] > c[0] * 1.12 && c[1] > c[2] * 1.12;
}

// Mean height of a region's faces above the local terrain (nDSM). Sampled —
// a couple hundred faces is plenty to tell ground from an elevated roof.
function meanHeightAbove(terrain, selected) {
  const v = new THREE.Vector3();
  let sum = 0;
  let n = 0;
  outer: for (const [mesh, faces] of selected) {
    const pos = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index;
    for (const f of faces) {
      let x = 0;
      let y = 0;
      let z = 0;
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(f * 3 + k) : f * 3 + k;
        v.fromBufferAttribute(pos, vi).applyMatrix4(mesh.matrixWorld);
        x += v.x;
        y += v.y;
        z += v.z;
      }
      sum += y / 3 - terrain.heightAt(x / 3, z / 3);
      n++;
      if (n >= 200) break outer;
    }
  }
  return n ? sum / n : 0;
}

// Height above local terrain that counts as "up off the ground". Expressed as
// a fraction of the mesh's vertical extent so it adapts to scale. NOTE: extent
// is dominated by terrain RELIEF (hillsides), not building height, so this is
// deliberately small — low single-storey buildings sit only a little above the
// local ground. Tune here (or pass groundClearance to autoTag). Shared by
// auto-tag and the explore inspector so they never disagree.
export const GROUND_CLEARANCE_FRACTION = 0.025;
export function defaultClearance(terrain) {
  return terrain ? Math.max((terrain.yMax - terrain.yMin) * GROUND_CLEARANCE_FRACTION, 1e-3) : 0;
}

// The single classification decision, shared by auto-tag and the explore
// inspector so what you see when tapping a surface is exactly what auto-tag
// would assign. Returns the class plus the reasoning behind it.
//   geomClass  — normal-derived surface class (roof-flat / wall / slope / …)
//   heightAbove — mean height above local terrain (nDSM), or null if no terrain
//   greenish   — colour says vegetation
export function classifyRegion({ selector, labels, terrain, targetClass, selected, clearance }) {
  let classId = labels.suggestFor({ targetClass, selected });
  const heightAbove = terrain ? meanHeightAbove(terrain, selected) : null;
  // Terrain-relative flat decision (see autoTag): ground vs roof by local height.
  if (targetClass === "roof-flat" && heightAbove != null) {
    classId = heightAbove < clearance ? "ground" : "building-roof";
  }
  const color = regionMeanColor(selector, selected);
  const greenish = isGreenish(color);
  if (classId !== "building-wall" && greenish) classId = "vegetation";
  return { classId, geomClass: targetClass, heightAbove, clearance, greenish, color };
}

export async function autoTag({
  selector,
  labels,
  root,
  onProgress,
  minFaces = MIN_FACES,
  minArea = MIN_AREA,
  maxLabels = MAX_AUTO_LABELS,
  groundClearance = null, // world units above local terrain that counts as "up off the ground"
}) {
  selector.ensureGlobalGraph(root);
  const tiles = labels.tileMeshes;

  // Bare-earth terrain so a flat surface is judged by its height above the
  // LOCAL ground, not a single global floor (which mislabels high ground as
  // roof). Default clearance scales with the mesh's vertical extent so it
  // adapts to the map's unknown real-world scale; tune via the param.
  const terrain = Terrain.build(root);
  const clearance = groundClearance != null ? groundClearance : defaultClearance(terrain);

  // visited[mesh][face] — seeded from existing labels so human work is
  // never overwritten and re-runs don't duplicate confirmed surfaces.
  const visited = new Map();
  for (const m of tiles) {
    visited.set(m, new Uint8Array(selector.ensureIntra(m).faceCount));
  }
  for (const label of labels.list) {
    for (const { t, df } of label.tiles) {
      const arr = visited.get(tiles[t]);
      if (!arr) continue;
      let acc = 0;
      for (const d of df) {
        acc += d;
        if (acc < arr.length) arr[acc] = 1;
      }
    }
  }

  let created = 0;
  let regions = 0;

  outer: for (let ti = 0; ti < tiles.length; ti++) {
    const mesh = tiles[ti];
    const arr = visited.get(mesh);

    for (let f = 0; f < arr.length; f++) {
      if (arr[f]) continue;

      const result = selector.select({ object: mesh, faceIndex: f }, root);
      if (!result || !result.totalSelected) {
        arr[f] = 1; // unclassifiable seed — never revisit
        continue;
      }

      // Claim only faces no earlier region took. select()'s per-seed normal
      // cone means two seeds can flood overlapping regions; without this the
      // labels would share triangles. First region to reach a face owns it.
      const claimed = new Map();
      let faceCount = 0;
      let area = 0;
      for (const [m, faces] of result.selected) {
        const va = visited.get(m);
        const fresh = new Set();
        for (const ff of faces) {
          if (va && va[ff]) continue; // already owned by an earlier region
          fresh.add(ff);
          if (va) va[ff] = 1;
        }
        if (fresh.size) {
          claimed.set(m, fresh);
          faceCount += fresh.size;
          area += worldArea(m, fresh);
        }
      }
      regions++;

      if (faceCount < minFaces || area < minArea) continue;

      const { classId } = classifyRegion({
        selector,
        labels,
        terrain,
        targetClass: result.targetClass,
        selected: claimed,
        clearance,
      });

      labels.add({
        selected: claimed,
        classId,
        confidence: "flagged", // red: machine proposal awaiting human review
        suggested: classId,
        targetClass: result.targetClass,
        source: "auto",
        deferPersist: true, // one persist at the end, not O(n²) serialization
      });
      created++;
      if (created >= maxLabels) break outer;
    }

    if (onProgress) onProgress(ti + 1, tiles.length, created);
    // Yield so the loading UI repaints between tiles.
    await new Promise((resolve) => setTimeout(resolve, 0));
  }

  labels.persist();
  return { created, regions };
}
