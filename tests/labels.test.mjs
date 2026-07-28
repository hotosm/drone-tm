// Labels.js: delta codec, suggestion heuristic, add/restore roundtrip.
import * as THREE from "three";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
};
globalThis.alert = () => {};

const { LabelManager, LABEL_CLASSES } = await import("../src/Labels.js");

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

function quadAt(y) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, y, 0, 1, y, 0, 1, y, 1, 0, y, 1], 3)
  );
  geom.setIndex([0, 2, 1, 0, 3, 2]);
  return new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
}
const ground = quadAt(0);
const roof = quadAt(3);
const mast = new THREE.Mesh(
  (() => {
    const g = new THREE.BufferGeometry();
    g.setAttribute(
      "position",
      new THREE.Float32BufferAttribute([5, 0, 5, 5.1, 0, 5, 5, 10, 5], 3)
    );
    g.setIndex([0, 1, 2]);
    return g;
  })(),
  new THREE.MeshBasicMaterial()
);

const root = new THREE.Group();
root.add(ground, roof, mast);
root.updateMatrixWorld(true);

const scene = new THREE.Scene();
const mgr = new LabelManager({ scene, root, mapKey: "test-map" });

assert(mgr.tileMeshes.length === 3, "3 tiles registered");
assert(Math.abs(mgr.bbox.max.y - 10) < 1e-6, "bbox height from mast");

const groundSel = new Map([[ground, new Set([0, 1])]]);
const roofSel = new Map([[roof, new Set([0, 1])]]);
assert(
  mgr.suggestFor({ targetClass: "roof-flat", selected: groundSel }) === "ground",
  "low horizontal surface suggests ground"
);
assert(
  mgr.suggestFor({ targetClass: "roof-flat", selected: roofSel }) === "building-roof",
  "elevated horizontal surface suggests roof"
);
assert(
  mgr.suggestFor({ targetClass: "wall", selected: roofSel }) === "building-wall",
  "wall class suggests wall"
);

const label = mgr.add({
  selected: roofSel,
  classId: "building-roof",
  confidence: "confirmed",
  suggested: "building-roof",
  targetClass: "roof-flat",
});
assert(label && label.faceCount === 2, "label stores 2 faces");
assert(Math.abs(label.area - 1.0) < 1e-3, `area of unit quad is 1.0 (got ${label.area})`);
assert(label.tiles[0].t === 1, "tile index is traversal order");
assert(JSON.stringify(label.tiles[0].df) === JSON.stringify([0, 1]), "delta encoding of [0,1]");
assert(scene.children.length === 1, "overlay painted into scene");

mgr.add({
  selected: new Map([[ground, new Set([1])]]),
  classId: "ground",
  confidence: "unsure",
  suggested: "ground",
  targetClass: "roof-flat",
});

const mgr2 = new LabelManager({ scene: new THREE.Scene(), root, mapKey: "test-map" });
const restored = mgr2.restore();
assert(restored === 2, `restore() returns 2 labels (got ${restored})`);
assert(mgr2.list[0].faceCount === 2 && mgr2.list[1].faceCount === 1, "face counts survive");
assert(mgr2.overlays.size === 2, "overlays repainted on restore");
assert(LABEL_CLASSES.some((c) => c.id === "building-roof"), "taxonomy exports");

// --- click-to-edit support ---
assert(mgr.findLabelAt(roof, 0) === label, "findLabelAt resolves owning label");
assert(mgr.findLabelAt(ground, 0) === null, "findLabelAt: unlabeled face → null");
assert(mgr.findLabelAt(ground, 1)?.class === "ground", "findLabelAt on second label");

const decoded = mgr.decodeSelection(label);
assert(
  decoded.get(roof)?.size === 2 && decoded.get(roof).has(0) && decoded.get(roof).has(1),
  "decodeSelection reproduces the stored face set"
);

const updated = mgr.update(label.id, {
  selected: new Map([[roof, new Set([0])]]),
  classId: "vegetation",
  confidence: "unsure",
});
assert(updated.faceCount === 1, "update rewrites geometry");
assert(updated.class === "vegetation" && updated.confidence === "unsure", "update rewrites class/confidence");
assert(mgr.overlays.has(label.id), "update repaints the overlay");
const mgr3 = new LabelManager({ scene: new THREE.Scene(), root, mapKey: "test-map" });
mgr3.restore();
assert(
  mgr3.list.find((l) => l.id === label.id)?.faceCount === 1,
  "updated label persists"
);

// --- view filtering + coverage ---
// State here: label (vegetation, unsure, 1 face on roof tile) and the
// ground label (ground, unsure, 1 face). Fixture areas: ground 1 + roof 1
// + mast 0.5 = 2.5 total; labeled = 0.5 + 0.5 = 1.0 → 40%.
const groundLabel = mgr.list.find((l) => l.class === "ground");

mgr.applyView({ mode: "confirmed", classId: null });
assert(
  !mgr.overlays.get(label.id).visible && !mgr.overlays.get(groundLabel.id).visible,
  "confirmed view hides unsure labels"
);
mgr.applyView({ mode: "untagged", classId: null });
assert(
  mgr.overlays.get(label.id).visible &&
    mgr.overlays.get(label.id).material.color.getHexString() === "191c19",
  "untagged view dims labeled areas to ink"
);
mgr.applyView({ mode: "all", classId: "vegetation" });
assert(
  mgr.overlays.get(label.id).visible && !mgr.overlays.get(groundLabel.id).visible,
  "class isolation shows only that class"
);
mgr.applyView({ mode: "all", classId: null });
assert(
  mgr.overlays.get(groundLabel.id).visible &&
    mgr.overlays.get(label.id).material.color.getHexString() !== "191c19",
  "all view restores visibility and class colors"
);

const cov = mgr.coverage();
assert(Math.abs(cov - 40) < 1, `coverage is area-weighted (expected ~40, got ${cov.toFixed(1)})`);

console.log("\nAll label tests passed.");
