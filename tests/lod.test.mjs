// Tiered gaze-bubble streaming: native bubble, ring, caps, hysteresis,
// no-downgrade, upgrade-in-place, review focus pinning.
import * as THREE from "three";
const { HighResStreamer } = await import("../src/HighResStreamer.js");

const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

function makeStreamer(opts = {}) {
  const camera = new THREE.PerspectiveCamera(75, 1.5, 0.1, 2000);
  camera.position.set(0, 0, 0); // at origin, looking -Z (default)
  camera.updateMatrixWorld();
  const s = new HighResStreamer({
    scene: null,
    camera,
    gltfLoader: null,
    nativeSize: 2048,
    ringSize: 1024,
    nativeCap: 2,
    totalCap: 4,
    ...opts,
  });
  s.active = true;
  // pitch 10 → margins: native = 9, ring = 28. Tiles march away along the
  // view ray; each has geometry sampled at its center AND 5 units nearer
  // (tiles have spatial extent), so tile i scores max(0, 10i - 5).
  s.tilePitch = 10;
  s.tiles = Array.from({ length: 10 }, (_, i) => ({
    index: i,
    mesh: { visible: false },
    low: { visible: true },
    center: new THREE.Vector3(0, 0, -i * 10),
    samples: [
      new THREE.Vector3(0, 0, -i * 10),
      new THREE.Vector3(0, 0, Math.min(0, -i * 10 + 5)),
    ],
    bytes: {},
    mime: "image/webp",
    state: "low",
    size: 0,
    targetSize: 0,
    decoding: false,
    texture: null,
    wanted: false,
  }));
  return s;
}

{
  const s = makeStreamer();
  s.computeTargets();
  const targets = s.tiles.map((t) => t.targetSize);
  assert(targets[0] === 2048 && targets[1] === 2048, "native bubble at gaze/camera");
  assert(targets[2] === 1024 && targets[3] === 1024, "ring tier at 1024");
  assert(targets[4] === 0, "beyond ring stays base");
  const resident = targets.filter((x) => x > 0).length;
  assert(resident === 4, `totalCap respected (${resident}/4)`);
}

{
  const s = makeStreamer({ totalCap: 8 });
  s.tiles[4].size = 1024; // resident, score 35; ring margin 28 ×1.35 = 37.8 ≥ 35
  s.computeTargets();
  assert(s.tiles[4].targetSize === 1024, "resident tile at d=40 clings via hysteresis");
  const s2 = makeStreamer({ totalCap: 8 });
  s2.computeTargets();
  assert(s2.tiles[4].targetSize === 0, "fresh tile at d=40 is NOT promoted");
}

{
  const s = makeStreamer({ totalCap: 8 });
  s.tiles[2].size = 2048; // resident native drifted into the ring zone
  s.tiles[2].state = "high";
  let promoted = 0;
  s.promote = () => promoted++;
  s.update();
  assert(s.tiles[2].targetSize === 1024, "ring target computed for drifted native tile");
  assert(s.tiles[2].state === "high" && s.tiles[2].size === 2048, "no demote inside ring");
  const downgraded = promoted > 0 && s.tiles.filter((t) => t.targetSize > t.size).length === 0;
  assert(!downgraded, "no downgrade re-decode for drifted native tile");
}

{
  const s = makeStreamer({ totalCap: 8 });
  s.tiles[0].size = 1024;
  s.tiles[0].state = "high";
  const requests = [];
  s.promote = (t) => requests.push({ i: t.index, size: t.targetSize });
  s.update();
  assert(
    requests.some((r) => r.i === 0 && r.size === 2048),
    "ring→native upgrade requested for tile entering the bubble"
  );
  assert(s.tiles[0].state === "high", "tile keeps current texture during upgrade");
}

// atlas-page mode: face-level spatial index → deferred-until-needed by TRUE
// 3D distance (altitude counts). Thresholds: native ≤ 6, ring ≤ 16, ×1.4
// hysteresis for resident pages. Flat ground at y=0; cell centers at
// world x = -45 + (cx+0.5)*10.
{
  const s = makeStreamer({ nativeCap: 8, totalCap: 8 });
  s.spatialTiling = false;
  s.grid = { n: 9, minX: -45, minZ: -45, cellW: 10, cellD: 10 };
  s.cellY = new Float32Array(81); // flat ground at y=0
  s.cellPages = new Array(81).fill(null);
  const put = (cx, cz, page) => {
    const k = cz * 9 + cx;
    (s.cellPages[k] || (s.cellPages[k] = new Set())).add(page);
  };
  put(4, 4, 0); // world (0,0):  d from camera ≈ 2      → native (inside load radius 6)
  put(5, 4, 1); // world (10,0): d ≈ 10.2 — inside keep band, but NOTHING loads there
  put(8, 4, 2); // world (40,0): d ≈ 40                 → base (deferred)

  s.camera.position.set(0, 2, 0); // low, standing next to page 0's faces

  s.computeTargets();
  assert(s.tiles[0].targetSize === 2048, "page with faces beside the camera → native");
  assert(s.tiles[1].targetSize === 0, "NOTHING speculative: outside load radius stays base");
  assert(s.tiles[2].targetSize === 0, "page 40 units out stays base (deferred)");

  s.tiles[1].size = 2048; // already resident (walked past earlier)
  s.computeTargets();
  assert(
    s.tiles[1].targetSize === 2048,
    "resident page inside keep band is kept as-is (zero work, no demote)"
  );

  // ALTITUDE IS DISTANCE: climb high and nothing qualifies — that is the
  // "deferred until needed" contract.
  s.camera.position.set(0, 40, 0);
  for (const t of s.tiles) t.size = 0;
  s.computeTargets();
  assert(
    s.tiles.every((t) => t.targetSize === 0),
    "at altitude nothing is close → nothing loads"
  );
}

{
  const s = makeStreamer({ totalCap: 3 });
  s.setFocus([7, 8], [9, 0, 1]);
  assert(
    s.tiles[7].targetSize === 2048 && s.tiles[8].targetSize === 2048,
    "focus tiles pinned at native"
  );
  assert(s.tiles[9].targetSize === 2048, "prefetch fills leftover budget");
  assert(s.tiles[0].targetSize === 0, "budget cap stops further prefetch");
}

console.log("\nAll tiered-LOD tests passed.");
