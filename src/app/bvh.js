import * as THREE from "three";
import { computeBoundsTree, disposeBoundsTree, acceleratedRaycast } from "three-mesh-bvh";

// three-mesh-bvh: give every raycast (nav collision, tap-select, brush pick,
// lasso occlusion) a bounding-volume hierarchy so it's ~O(log n) instead of
// testing all ~288k triangles. Patch the THREE prototypes ONCE at import.
//
// CRITICAL: build with `indirect: true`. The default BVH REORDERS the geometry
// index for spatial locality, which would invalidate the face indices that
// labels/selection are keyed to (the whole app rests on stable face indices).
// The indirect BVH keeps geometry.index untouched and still reports original
// faceIndex from raycasts.
THREE.BufferGeometry.prototype.computeBoundsTree = computeBoundsTree;
THREE.BufferGeometry.prototype.disposeBoundsTree = disposeBoundsTree;
THREE.Mesh.prototype.raycast = acceleratedRaycast;

// Build (index-preserving) bounds trees for every mesh under a root. Safe to
// call again — computeBoundsTree replaces any existing tree.
export function buildBoundsTrees(root) {
  if (!root) return;
  root.traverse((child) => {
    if (child.isMesh && child.geometry && !child.geometry.boundsTree) {
      child.geometry.computeBoundsTree({ indirect: true });
    }
  });
}

// Free bounds trees under a root (called before disposing a swapped-out mesh).
export function disposeBoundsTrees(root) {
  if (!root) return;
  root.traverse((child) => {
    if (child.isMesh && child.geometry && child.geometry.boundsTree) {
      child.geometry.disposeBoundsTree();
    }
  });
}
