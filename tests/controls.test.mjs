// FirstPersonControls: nav collision clamping + two-finger twist-to-rotate.
// Importing the harness installs the jsdom globals the controls constructor
// needs (document / element listeners).
import { THREE, assert } from "./harness.mjs";
import { FirstPersonControls } from "../src/FirstPersonControls.js";

// A double-sided quad wall in the z = -5 plane (a ray down -Z hits it at 5u).
function makeWall(z) {
  const g = new THREE.BufferGeometry();
  g.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([-3, -3, z, 3, -3, z, 3, 3, z, -3, 3, z], 3)
  );
  g.setIndex([0, 2, 1, 0, 3, 2]);
  return new THREE.Mesh(g, new THREE.MeshBasicMaterial({ side: THREE.DoubleSide }));
}

function makeControls() {
  const camera = new THREE.PerspectiveCamera(75, 1.6, 0.3, 1200);
  const dom = document.createElement("canvas");
  return { fpc: new FirstPersonControls(camera, dom), camera };
}

// --- collision: nav can't cross geometry in the direction of travel --------
{
  const { fpc, camera } = makeControls();
  fpc.collider = makeWall(-5);
  fpc.collider.updateMatrixWorld(true);
  camera.position.set(0, 0, 0);

  fpc.moveBy(new THREE.Vector3(0, 0, -10)); // barrel toward the wall
  const stop = -5 + fpc.collideMargin; // ≈ -4.6
  assert(
    Math.abs(camera.position.z - stop) < 0.15,
    `forward move clamps a margin off the wall (z=${camera.position.z.toFixed(2)}, expect ~${stop})`
  );

  const zBlocked = camera.position.z;
  fpc.moveBy(new THREE.Vector3(0, 0, 10)); // retreat
  assert(camera.position.z > zBlocked + 9, "retreating away from the wall is unclamped");
}

// --- no collider → free movement (behavior preserved off-mesh) -------------
{
  const { fpc, camera } = makeControls();
  fpc.collider = null;
  camera.position.set(0, 0, 0);
  fpc.moveBy(new THREE.Vector3(0, 0, -10));
  assert(camera.position.z === -10, "no collider → move is unclamped");
}

console.log("\nAll controls tests passed.");
