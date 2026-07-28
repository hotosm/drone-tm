// SurfaceSelector flood fill: cross-tile bridging, UV-seam stitching,
// classification containment, symmetry, cache reuse.
import * as THREE from "three";
import { SurfaceSelector } from "../src/SurfaceSelector.js";

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

function makeMesh(positions, indices) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  geom.setIndex(indices);
  // no normal attribute on purpose: exercise the geometric-normal path
  return new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
}

// meshA: two flat quads with a duplicated-vertex seam along z=1
const meshA = makeMesh(
  [
    0, 0, 0,  1, 0, 0,  1, 0, 1,  0, 0, 1,   // island 1: [0..1]x[0..1]
    0, 0, 1,  1, 0, 1,  1, 0, 2,  0, 0, 2,   // island 2: duplicated verts on z=1
  ],
  [0, 2, 1, 0, 3, 2, 4, 6, 5, 4, 7, 6]
);
// meshB: quad [1..2]x[0..1], boundary x=1 shared with meshA
const meshB = makeMesh([1, 0, 0, 2, 0, 0, 2, 0, 1, 1, 0, 1], [0, 2, 1, 0, 3, 2]);
// meshC: vertical wall at x=2, shares the x=2 edge with meshB
const meshC = makeMesh([2, 0, 0, 2, 1, 0, 2, 1, 1, 2, 0, 1], [0, 2, 1, 0, 3, 2]);

const root = new THREE.Group();
root.add(meshA, meshB, meshC);
root.updateMatrixWorld(true);

const selector = new SurfaceSelector(null);

const n = selector.faceWorldNormal(meshA, 0);
assert(Math.abs(n.y - 1) < 1e-6, `meshA face0 normal is +Y (got ${n.toArray()})`);
assert(selector.classify(n) === "roof-flat", "flat quad classifies roof-flat");

const r1 = selector.select({ object: meshA, faceIndex: 0 }, root);
const inA = r1.selected.get(meshA)?.size ?? 0;
const inB = r1.selected.get(meshB)?.size ?? 0;
const inC = r1.selected.get(meshC)?.size ?? 0;
assert(inA === 4, "UV-seam stitch: both islands of meshA selected (4 faces)");
assert(inB === 2, "cross-tile: meshB fully selected (2 faces)");
assert(inC === 0, "wall excluded by classification");
assert(r1.totalSelected === 6, "total 6 faces");
assert(r1.targetClass === "roof-flat", `class is roof-flat (got ${r1.targetClass})`);

const r2 = selector.select({ object: meshB, faceIndex: 1 }, root);
assert(r2.totalSelected === 6, "selection symmetric from meshB seed");

const r3 = selector.select({ object: meshC, faceIndex: 0 }, root);
assert((r3.selected.get(meshC)?.size ?? 0) === 2, "wall selects both wall faces");
assert(r3.totalSelected === 2, "wall selection does not leak onto ground");
assert(r3.targetClass === "wall", `wall classifies wall (got ${r3.targetClass})`);

const r4 = selector.select({ object: meshA, faceIndex: 3 }, root);
assert(r4.totalSelected === 6, "repeat select via cached graphs still 6 faces");

// --- grow / shrink refinement tools ---
const count = (map) => [...map.values()].reduce((n, s) => n + s.size, 0);

// grow is unconstrained: crosses the class boundary onto the wall via the
// shared x=2 edge (one wall face adjoins it, the second follows next ring)
const g1 = selector.growSelection(r1.selected, root);
assert(count(g1) === 7, `grow adds the adjoining wall face (got ${count(g1)})`);
const g2 = selector.growSelection(g1, root);
assert(count(g2) === 8, `second grow completes the wall (got ${count(g2)})`);

// shrink erodes the boundary ring; on this tiny fixture every flat face
// touches an open map edge, so one shrink erodes the lot
const s1 = selector.shrinkSelection(r1.selected, root);
assert(count(s1) === 0, `shrink erodes boundary faces (got ${count(s1)})`);

// --- connectedWithin: brush orphan pruning (keep only faces connected to
// the seed). An isolated mesh in the allowed set must be dropped.
const isolated = makeMesh([50, 0, 50, 51, 0, 50, 51, 0, 51, 50, 0, 51], [0, 2, 1, 0, 3, 2]);
root.add(isolated);
root.updateMatrixWorld(true);
const allowed = new Map([
  [meshA, new Set([0, 1, 2, 3])],
  [meshB, new Set([0, 1])],
  [isolated, new Set([0, 1])],
]);
const conn = selector.connectedWithin(new Map([[meshA, new Set([0])]]), allowed, root);
assert((conn.get(meshA)?.size ?? 0) === 4, "connectedWithin keeps the seed surface");
assert(!conn.has(isolated), "connectedWithin drops the disconnected orphan");

// --- floodFromFace: brush surface flood with an accept predicate ---
// seed always kept; accept excludes meshB → can't reach meshC (only linked
// via meshB) nor the isolated mesh.
const flood = selector.floodFromFace(meshA, 0, (m) => m !== meshB, root);
assert((flood.get(meshA)?.size ?? 0) === 4, "floodFromFace fills the seed surface");
assert(!flood.has(meshB), "floodFromFace honours the accept predicate");
assert(!flood.has(meshC) && !flood.has(isolated), "floodFromFace stays on the connected surface");

console.log("\nAll selector tests passed.");
