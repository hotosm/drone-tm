// Auto-tagger: full-map segmentation → flagged proposals; human labels
// untouched; vegetation colour override; single-shot persistence.
import * as THREE from "three";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
};
globalThis.alert = () => {};

const { SurfaceSelector } = await import("../src/SurfaceSelector.js");
const { LabelManager } = await import("../src/Labels.js");
const { autoTag } = await import("../src/AutoTagger.js");

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
const canopy = quadAt(4);
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
root.add(ground, roof, canopy, mast);
root.updateMatrixWorld(true);

const scene = new THREE.Scene();
const labels = new LabelManager({ scene, root, mapKey: "auto-test" });
const selector = new SurfaceSelector(scene);
const GREEN = [60, 160, 70];
const GREY = [140, 130, 120];
selector.faceColor = (mesh) => (mesh === canopy ? GREEN : GREY);

labels.add({
  selected: new Map([[ground, new Set([0, 1])]]),
  classId: "ground",
  confidence: "confirmed",
  suggested: "ground",
  targetClass: "roof-flat",
});

const res = await autoTag({ selector, labels, root, minFaces: 1, minArea: 0.01 });

const auto = labels.list.filter((l) => l.source === "auto");
const human = labels.list.filter((l) => l.source === "human");

assert(human.length === 1 && human[0].confidence === "confirmed", "human label untouched");
assert(auto.every((l) => l.confidence === "flagged"), "proposals arrive red/flagged");
assert(!auto.some((l) => l.tiles.some((t) => t.t === 0)), "labeled ground NOT re-proposed");
assert(auto.some((l) => l.class === "building-roof"), "elevated grey quad proposed as roof");
assert(auto.some((l) => l.class === "vegetation"), "elevated GREEN quad becomes vegetation");
assert(res.created === auto.length, "created count matches");

const labels2 = new LabelManager({ scene: new THREE.Scene(), root, mapKey: "auto-test" });
labels2.restore();
assert(labels2.list.length === labels.list.length, "all labels persisted in one shot");
assert(
  labels2.list.filter((l) => l.source === "auto").length === auto.length,
  "provenance survives storage"
);

const removed = labels.removeAuto();
assert(removed === auto.length, "removeAuto clears proposals");
assert(labels.list.length === 1 && labels.list[0].source === "human", "human label survives");

console.log("\nAll auto-tag tests passed.");
