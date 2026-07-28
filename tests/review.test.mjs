// Review mode: full base mesh stays visible, textures stream by on-screen
// pick (orbit mode, same as explore) rather than pinning the item's own atlas
// pages, queue ordering + verbs, storage roundtrip.
import * as THREE from "three";

const store = new Map();
globalThis.localStorage = {
  getItem: (k) => (store.has(k) ? store.get(k) : null),
  setItem: (k, v) => store.set(k, v),
};
globalThis.alert = () => {};

const { HighResStreamer } = await import("../src/HighResStreamer.js");
const { LabelManager } = await import("../src/Labels.js");
const { ReviewMode } = await import("../src/ReviewMode.js");

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

function quadAt(x, y) {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([x, y, 0, x + 1, y, 0, x + 1, y, 1, x, y, 1], 3)
  );
  geom.setIndex([0, 2, 1, 0, 3, 2]);
  return new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
}
const near = quadAt(0, 3); // tile 0
const far = quadAt(40, 0); // tile 1
const root = new THREE.Group();
root.add(near, far);
root.updateMatrixWorld(true);

const labels = new LabelManager({ scene: new THREE.Scene(), root, mapKey: "rv2" });
labels.add({
  selected: new Map([[far, new Set([0, 1])]]),
  classId: "ground",
  confidence: "unsure",
  suggested: "ground",
  targetClass: "roof-flat",
});
labels.add({
  selected: new Map([[near, new Set([0, 1])]]),
  classId: "building-roof",
  confidence: "unsure",
  suggested: "building-roof",
  targetClass: "roof-flat",
});

const camera = new THREE.PerspectiveCamera(75, 0.6, 0.1, 2000);
camera.position.set(0, 6, 6);
const orbit = { target: new THREE.Vector3(), update() {}, enabled: false };

const streamer = new HighResStreamer({
  scene: null,
  camera,
  gltfLoader: null,
  nativeSize: 1024,
  ringSize: 1024,
  nativeCap: 2,
  totalCap: 2,
});
streamer.active = true;
streamer.tilePitch = 40;
streamer.tiles = [near, far].map((lowMesh, i) => ({
  index: i,
  mesh: { visible: false },
  low: lowMesh,
  center: new THREE.Vector3(i * 40, 0, 0),
  bytes: {},
  mime: "image/webp",
  state: "low",
  size: 0,
  targetSize: 0,
  decoding: false,
  texture: null,
  wanted: false,
}));
streamer.promote = (t) => {
  t.state = "high";
  t.size = t.targetSize;
  streamer.applyTileVisibility(t);
};

const review = new ReviewMode({
  camera,
  orbit,
  labels,
  streamer,
  ui: null,
  onChange: () => {},
  onExit: () => {},
});

assert(review.enter() === true, "enter() succeeds");
assert(review.queue[0].label.class === "building-roof", "NN ordering: near item first");
assert(
  streamer.reviewOrbit === true && streamer.focusTiles === null,
  "review streams by on-screen pick (orbit), not page-pinned focus"
);
for (const t of streamer.tiles) {
  assert(t.mesh.visible !== t.low.visible, `tile ${t.index} visible at exactly one LOD`);
}

review.correct();
assert(streamer.reviewOrbit === true, "advancing keeps review orbit streaming active");
assert(
  labels.list.find((l) => l.class === "building-roof").confidence === "confirmed",
  "Correct persists confirmed"
);

review.reclass("vegetation");
assert(review.index === review.queue.length, "queue complete");
assert(review.stats.confirmed === 1 && review.stats.reclassed === 1, "stats tallied");

review.exit();
assert(streamer.reviewOrbit === false, "exit returns streamer to explore proximity");

// no-streamer fallback (reset visibility first — streamer scenario above
// legitimately hid low meshes behind their promoted fakes)
streamer.active = false;
near.visible = true;
far.visible = true;
const review2 = new ReviewMode({ camera, orbit, labels, streamer: null, ui: null });
assert(review2.enter() === true, "enter() works with no streamer yet");
assert(near.visible && far.visible, "all base tiles remain visible without streamer");
review2.skip();
review2.skip();
review2.exit();

const labels2 = new LabelManager({ scene: new THREE.Scene(), root, mapKey: "rv2" });
labels2.restore();
assert(
  labels2.list.every((l) => l.confidence === "confirmed"),
  "review verdicts survived the storage roundtrip"
);

// in-review adjustment support: refresh reframes a mutated label; removing
// the current item advances the queue
const review3 = new ReviewMode({ camera, orbit, labels, streamer: null, ui: null });
assert(review3.enter() === true, "third review session enters");
const before = review3.cur().bbox.getSize(new THREE.Vector3()).x;
labels.update(review3.cur().label.id, {
  selected: new Map([[near, new Set([0])]]), // half the faces
});
review3.refreshCurrentItem();
assert(
  review3.cur().bbox.getSize(new THREE.Vector3()).x <= before,
  "refreshCurrentItem recomputes framing from the edited label"
);
review3.removeCurrentItem();
assert(review3.queue.length === 1, "removeCurrentItem drops the deleted item");
assert(review3.cur() !== undefined || review3.index === review3.queue.length,
  "queue presents next item or completes");
review3.exit();

console.log("\nAll review-mode tests passed.");
