// Colour-assisted ridge crossing (opt-in): same-colour slopes 90° apart
// merge, different colours refuse, walls never join, default is v1 behavior.
import * as THREE from "three";
import { SurfaceSelector } from "../src/SurfaceSelector.js";

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

// verts: ridge r0,r1 · slope A (z+) · slope B (z-) · wall vert w
// faces: 0,1 = slope A · 2,3 = slope B · 4 = wall at x=2
function buildRoof() {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute(
      [0, 1, 0, 2, 1, 0, 2, 0, 1, 0, 0, 1, 2, 0, -1, 0, 0, -1, 2, 0, 0],
      3
    )
  );
  geom.setIndex([0, 2, 1, 0, 3, 2, 0, 1, 4, 0, 4, 5, 1, 2, 6]);
  const mesh = new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
  const root = new THREE.Group();
  root.add(mesh);
  root.updateMatrixWorld(true);
  return { mesh, root };
}

const RUST = [200, 80, 60];
const GREEN = [60, 150, 80];

function selectorWithColors(colorByFace) {
  const s = new SurfaceSelector(null);
  s.enableRidgeCrossing = true; // machinery is opt-in (default off)
  s.faceColor = (mesh, f) => colorByFace(f);
  return s;
}

{
  const { mesh } = buildRoof();
  const s = new SurfaceSelector(null);
  assert(s.classify(s.faceWorldNormal(mesh, 0)) === "roof-pitched", "slope A is roof-pitched");
  assert(s.classify(s.faceWorldNormal(mesh, 2)) === "roof-pitched", "slope B is roof-pitched");
  assert(s.classify(s.faceWorldNormal(mesh, 4)) === "wall", "side face is wall");
  const a = s.faceWorldNormal(mesh, 0).clone();
  assert(a.dot(s.faceWorldNormal(mesh, 2)) < 0.1, "slopes ~90° apart (outside the cone)");
}

{
  const { mesh, root } = buildRoof();
  const s = selectorWithColors(() => RUST);
  const r = s.select({ object: mesh, faceIndex: 0 }, root);
  assert(r.totalSelected === 4, `same-colour ridge crossing selects both slopes (got ${r.totalSelected})`);
  assert(!r.selected.get(mesh).has(4), "same-coloured WALL excluded by family gate");
}

{
  const { mesh, root } = buildRoof();
  const s = selectorWithColors((f) => (f >= 2 ? GREEN : RUST));
  const r = s.select({ object: mesh, faceIndex: 0 }, root);
  assert(r.totalSelected === 2, `different-colour slope stays out (got ${r.totalSelected})`);
}

{
  const { mesh, root } = buildRoof();
  const s = new SurfaceSelector(null); // no texture, no DOM -> colour unavailable
  s.enableRidgeCrossing = true;
  const r = s.select({ object: mesh, faceIndex: 0 }, root);
  assert(r.totalSelected === 2, `colour-less fallback selects seed slope only (got ${r.totalSelected})`);
}

{
  const { mesh, root } = buildRoof();
  const s = selectorWithColors(() => RUST);
  const r = s.select({ object: mesh, faceIndex: 3 }, root);
  assert(r.totalSelected === 4, "crossing symmetric from slope B seed");
}

{
  const { mesh, root } = buildRoof();
  const s = new SurfaceSelector(null);
  s.faceColor = () => RUST; // colour available but crossing disabled
  const r = s.select({ object: mesh, faceIndex: 0 }, root);
  assert(s.enableRidgeCrossing === false, "ridge crossing is off by default");
  assert(r.totalSelected === 2, `default selection stays on the seed slope (got ${r.totalSelected})`);
}

console.log("\nAll colour-crossing tests passed.");
