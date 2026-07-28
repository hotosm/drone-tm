import * as THREE from "three";

// Surface selection + paint: pointer/keyboard wiring, the flood-fill tap path
// (start / add / subtract / edit-existing), the pending-selection lifecycle
// (refresh, undo, grow, shrink, cancel), and the PaintTools glue (applyPaint,
// brush raycast-seed + depth-banded flood, candidate gathering). A behavior
// controller: the pending selection / undo stack / edit target are
// coordinator-shared state on the app (every controller touches them), so this
// owns behavior only. `this` is the controller, `this.app` the MeshExplorer.

const ENABLE_SURFACE_SELECTION = true;

export class SelectionController {
  constructor(app) {
    this.app = app;
  }

  setupSurfaceSelection() {
    // Skip if surface selection is disabled
    if (!ENABLE_SURFACE_SELECTION) return;

    const canvas = this.app.renderer.domElement;

    // A look-drag still fires a "click" on mouseup (and isMouseDown is already
    // false by then), which used to select a surface after every camera
    // rotate. Track pointer travel and ignore clicks that moved.
    let downPos = null;
    canvas.addEventListener("mousedown", (event) => {
      downPos = { x: event.clientX, y: event.clientY };
    });
    canvas.addEventListener("click", (event) => {
      if (downPos) {
        const dx = event.clientX - downPos.x;
        const dy = event.clientY - downPos.y;
        if (dx * dx + dy * dy > 25) return; // moved >5px: that was a look, not a click
      }
      this.handleSurfaceSelection(event.clientX, event.clientY, {
        add: event.shiftKey, // momentary overrides; intent axis is the default
        sub: event.altKey,
      });
    });

    // Touch tap-to-select: only fire on a genuine STATIONARY single-finger
    // tap. A one-finger orbit drag ends in touchend too, so gate hard on
    // travel + duration + single-finger (multi-touch = zoom/pan, never tag).
    let tStart = null;
    let multiTouch = false;
    canvas.addEventListener(
      "touchstart",
      (event) => {
        if (event.touches.length > 1) {
          multiTouch = true;
          tStart = null;
          return;
        }
        multiTouch = false;
        const t = event.touches[0];
        tStart = { x: t.clientX, y: t.clientY, t: performance.now() };
      },
      { passive: true }
    );
    canvas.addEventListener("touchend", (event) => {
      if (multiTouch || !tStart) return; // was a gesture, not a tap
      if (event.touches.length !== 0 || event.changedTouches.length !== 1) return;
      const t = event.changedTouches[0];
      const dx = t.clientX - tStart.x;
      const dy = t.clientY - tStart.y;
      const moved = dx * dx + dy * dy > 100; // >10px travel = an orbit, not a tap
      const slow = performance.now() - tStart.t > 500; // long press ≠ tap
      tStart = null;
      if (moved || slow) return;
      this.handleSurfaceSelection(t.clientX, t.clientY, {});
    });

    window.addEventListener("keydown", (event) => {
      if (event.key === "Escape") {
        if (this.app.mode === "review" && this.app.reviewCtl.pendingDirty) {
          this.cancelPendingSelection(); // discard edits, stay on the item
        } else if (this.app.mode === "review" && this.app.review) {
          this.app.review.exit();
        } else {
          this.cancelPendingSelection();
        }
        return;
      }
      if (event.key === "z" && this.app.pending && (this.app.mode === "explore" || this.app.reviewCtl.reviewAdjust)) {
        this.undoPending();
        return;
      }
      // Live LOD range tuning in ?debug: [ shrinks the load/reveal radii,
      // ] grows them. Rings + HUD update live; report the multiplier that
      // feels right and it becomes the default.
      if (this.app.debugLOD && this.app.streamer && (event.key === "[" || event.key === "]")) {
        const s = this.app.streamer;
        s.rangeScale =
          event.key === "["
            ? Math.max(0.25, s.rangeScale * 0.8)
            : Math.min(4, s.rangeScale * 1.25);
        s.update();
        this.app.updateLODDebug();
        return;
      }
      // Desktop review shortcuts (FirstPersonControls is disabled in review,
      // so no WASD conflicts).
      if (this.app.mode === "review" && this.app.review && this.app.review.active && !this.app.reviewCtl.pendingDirty) {
        if (event.key === "Enter") this.app.review.correct();
        else if (event.key === "s" || event.key === "S") this.app.review.skip();
        else if (event.key === "f" || event.key === "F") this.app.review.flag();
      }
    });

    this.app.labelingCtl.initLabelUI();
  }

  handleSurfaceSelection(clientX, clientY, rawMods = {}) {
    if (this.app.chrome.editTool !== "tap") return; // brush/lasso own the pointer
    const adjusting = this.app.mode === "review" && this.app.reviewCtl.reviewAdjust;
    if (this.app.mode !== "explore" && !adjusting) return;
    if (!this.app.currentMesh || !this.app.selector) return;

    // Resolve add/remove: Shift/Alt are momentary overrides of the current
    // intent; otherwise the intent axis decides. Extending an existing
    // selection with tap defaults to the intent; a first tap always starts
    // fresh. In review adjust, a bare tap must never abandon the item.
    const mods = {
      add: rawMods.add || (!rawMods.sub && this.app.chrome.editIntent === "add"),
      sub: rawMods.sub || (!rawMods.add && this.app.chrome.editIntent === "remove"),
    };
    if (adjusting && !this.app.pending) return; // shouldn't happen; guard

    // Convert screen coordinates to normalized device coordinates
    this.app.mouse.x = (clientX / window.innerWidth) * 2 - 1;
    this.app.mouse.y = -(clientY / window.innerHeight) * 2 + 1;

    this.app.raycaster.setFromCamera(this.app.mouse, this.app.camera);

    // Raycast the low-res mesh only. It is the canonical label substrate:
    // its geometry never changes while high-res textures stream in and out,
    // so face indices stay valid. (three's raycaster ignores `visible`, which
    // is exactly what we want for tiles whose low-res twin is hidden.)
    const intersects = this.app.raycaster.intersectObject(this.app.currentMesh, true);
    if (!intersects.length) return; // empty space: leave selection; Cancel/Esc clears
    const hit = intersects[0];

    // Tap with no pending selection: edit an existing label if we hit one,
    // else start a fresh selection.
    if (!this.app.pending && !adjusting && this.app.labels) {
      const owner = this.app.labels.findLabelAt(hit.object, hit.faceIndex);
      if (owner) {
        this.app.labelingCtl.enterEditLabel(owner);
        return;
      }
    }

    // Subtract: remove the flood region under the click from the pending set.
    if (mods.sub && this.app.pending) {
      const region = this.app.selector.select(hit, this.app.currentMesh);
      if (!region || !region.totalSelected) return;
      this.pushPendingHistory();
      for (const [mesh, faces] of region.selected) {
        const set = this.app.pending.selected.get(mesh);
        if (!set) continue;
        for (const f of faces) set.delete(f);
        if (!set.size) this.app.pending.selected.delete(mesh);
      }
      if (!this.app.pending.selected.size) {
        this.cancelPendingSelection();
        return;
      }
      this.app.pending.clicks++;
      this.refreshPending();
      return;
    }

    const result = this.app.selector.select(hit, this.app.currentMesh);
    if (!result || result.totalSelected === 0) return;

    if (mods.add && this.app.pending) {
      this.pushPendingHistory();
      for (const [mesh, faces] of result.selected) {
        let set = this.app.pending.selected.get(mesh);
        if (!set) {
          set = new Set();
          this.app.pending.selected.set(mesh, set);
        }
        for (const f of faces) set.add(f);
      }
      this.app.pending.clicks++;
    } else {
      if (this.app.editingLabelId) this.app.labelingCtl.exitEditState(); // clicked away mid-edit
      this.app.pendingHistory = [];
      this.app.pending = {
        selected: result.selected,
        targetClass: result.targetClass,
        clicks: 1,
      };
    }
    this.refreshPending();
  }

  // Recompute pending stats, redraw the highlight, refresh whichever surface
  // owns the interaction (review sheet vs explore panel).
  refreshPending() {
    const p = this.app.pending;
    if (!p) return;
    p.faceCount = 0;
    for (const set of p.selected.values()) p.faceCount += set.size;
    p.suggested = this.app.labels ? this.app.labels.suggestFor(p) : "other";
    this.app.selector.showFaces(p.selected);
    if (this.app.mode === "review" && this.app.reviewCtl.reviewAdjust) {
      this.app.reviewCtl.pendingDirty = true;
      this.app.reviewCtl.updateReviewSheet();
    } else {
      this.app.labelingCtl.showLabelPanel();
      // in explore, drag now orbits around the live selection
      if (this.app.controls) this.app.controls.orbitTarget = this.selectionCenter();
      this.app.updateInspector();
    }
    this.app.chrome.syncDock();
  }

  // World-space centroid of the pending selection (sampled), for orbit + focus.
  selectionCenter() {
    if (!this.app.pending || !this.app.pending.selected.size) return null;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    let n = 0;
    outer: for (const [mesh, faces] of this.app.pending.selected) {
      const pos = mesh.geometry.getAttribute("position");
      const index = mesh.geometry.index;
      for (const f of faces) {
        const idx = index ? index.getX(f * 3) : f * 3;
        box.expandByPoint(v.fromBufferAttribute(pos, idx).applyMatrix4(mesh.matrixWorld));
        if (++n >= 600) break outer; // a sample frames it fine
      }
    }
    return box.isEmpty() ? null : box.getCenter(new THREE.Vector3());
  }

  pushPendingHistory() {
    if (!this.app.pending) return;
    const snap = new Map();
    for (const [mesh, faces] of this.app.pending.selected) snap.set(mesh, new Set(faces));
    this.app.pendingHistory.push(snap);
    if (this.app.pendingHistory.length > 20) this.app.pendingHistory.shift();
  }

  undoPending() {
    if (!this.app.pending || !this.app.pendingHistory.length) return;
    this.app.pending.selected = this.app.pendingHistory.pop();
    this.app.pending.clicks = Math.max(1, this.app.pending.clicks - 1);
    this.refreshPending();
  }

  growPending() {
    if (!this.app.pending || !this.app.selector) return;
    this.pushPendingHistory();
    this.app.pending.selected = this.app.selector.growSelection(
      this.app.pending.selected,
      this.app.currentMesh
    );
    this.refreshPending();
  }

  shrinkPending() {
    if (!this.app.pending || !this.app.selector) return;
    this.pushPendingHistory();
    const shrunk = this.app.selector.shrinkSelection(
      this.app.pending.selected,
      this.app.currentMesh
    );
    if (!shrunk.size) return; // never shrink to nothing — undo is for that
    this.app.pending.selected = shrunk;
    this.refreshPending();
  }

  cancelPendingSelection() {
    this.app.chrome.setIntent("add"); // erase off; keep the user's current tool
    if (this.app.controls && this.app.controls.orbitTarget) {
      this.app.controls.orbitTarget = null; // back to free look
      this.app.controls.syncFromCamera(); // adopt current orientation (no snap)
    }
    // In review, "cancel" means discard edits: re-present the item fresh.
    if (this.app.mode === "review" && this.app.reviewCtl.reviewAdjust && this.app.review) {
      this.app.review.show(this.app.review.index);
      return;
    }
    this.app.labelingCtl.exitEditState();
    this.app.pending = null;
    this.app.pendingHistory = [];
    if (this.app.selector) this.app.selector.clearHighlight();
    this.app.chrome.showDock(false);
    if (this.app.labelingCtl.ui) this.app.labelingCtl.ui.panel.classList.remove("active");
    this.app.updateInspector();
  }

  applyPaint(intent, map) {
    if (intent === "add" && !this.app.pending) {
      const sel = new Map();
      for (const [mesh, faces] of map) sel.set(mesh, new Set(faces));
      let targetClass = "roof-flat";
      const first = [...map.entries()][0];
      if (first && first[1].size) {
        const f0 = [...first[1]][0];
        targetClass = this.app.selector.classify(this.app.selector.faceWorldNormal(first[0], f0));
      }
      this.app.pending = { selected: sel, targetClass, clicks: 1 };
      this.app.pending.faceCount = 0;
      this.app.pending.suggested = this.app.labels ? this.app.labels.suggestFor(this.app.pending) : "other";
      this.app.labelingCtl.pickClass(this.app.pending.suggested);
      this.app.labelingCtl.pickConfidence("confirmed");
      this.app.pending.clicks = 2; // suggestion applied; don't re-pick as it grows
      this.refreshPending();
      return;
    }
    if (!this.app.pending) return;
    if (intent === "add") {
      for (const [mesh, faces] of map) {
        let set = this.app.pending.selected.get(mesh);
        if (!set) { set = new Set(); this.app.pending.selected.set(mesh, set); }
        for (const f of faces) set.add(f);
      }
    } else {
      for (const [mesh, faces] of map) {
        const set = this.app.pending.selected.get(mesh);
        if (!set) continue;
        for (const f of faces) set.delete(f);
        if (!set.size) this.app.pending.selected.delete(mesh);
      }
      if (!this.app.pending.selected.size && this.app.mode === "explore") {
        this.cancelPendingSelection();
        return;
      }
    }
    this.refreshPending();
  }


  // Brush: raycast the frontmost face under the cursor (occlusion-correct
  // seed), then flood the connected surface from it, keeping faces that are
  // in the brush disc AND within a depth band of the hit surface. The depth
  // band rejects anything behind (back walls, floor beyond a roof); the flood
  // + disc keep it local and contiguous. One ray per move, so it's cheap.
  onBrush(px, py, radiusPx) {
    if (!this.app.currentMesh || !this.app.selector) return;
    const hit = this.pickSurfaceFace(px, py);

    if (this.app.chrome.editIntent === "remove") {
      if (!this.app.pending || !hit) return;
      // remove the connected patch of the pending selection under the cursor
      const rm = this.app.selector.floodFromFace(
        hit.mesh,
        hit.face,
        this.brushAccept(px, py, radiusPx, hit.dist, (m, f) => {
          const s = this.app.pending.selected.get(m);
          return s ? s.has(f) : false;
        }),
        this.app.currentMesh
      );
      if (rm.size && this.app.pending.selected.has(hit.mesh)) this.applyPaint("remove", rm);
      return;
    }

    if (!hit) return;
    const added = this.app.selector.floodFromFace(
      hit.mesh,
      hit.face,
      this.brushAccept(px, py, radiusPx, hit.dist),
      this.app.currentMesh
    );
    if (added.size) this.applyPaint("add", added);
  }

  // accept(mesh, faceIdx): face centroid is in the brush disc AND within a
  // depth band of the hit surface (+ optional extra predicate).
  brushAccept(px, py, radiusPx, anchorDist, extra) {
    const w = this.app.renderer.domElement.clientWidth;
    const h = this.app.renderer.domElement.clientHeight;
    const r2 = radiusPx * radiusPx;
    const band = Math.max(1.5, anchorDist * 0.06);
    const cam = this.app.camera.position;
    const c = new THREE.Vector3();
    const v = new THREE.Vector3();
    return (mesh, f) => {
      if (extra && !extra(mesh, f)) return false;
      const pos = mesh.geometry.getAttribute("position");
      const index = mesh.geometry.index;
      c.set(0, 0, 0);
      for (let k = 0; k < 3; k++) {
        const vi = index ? index.getX(f * 3 + k) : f * 3 + k;
        c.add(v.fromBufferAttribute(pos, vi));
      }
      c.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld);
      if (Math.abs(c.distanceTo(cam) - anchorDist) > band) return false; // behind → reject
      c.project(this.app.camera);
      if (c.z < -1 || c.z > 1) return false;
      const sx = (c.x * 0.5 + 0.5) * w;
      const sy = (-c.y * 0.5 + 0.5) * h;
      const dx = sx - px, dy = sy - py;
      return dx * dx + dy * dy <= r2;
    };
  }

  // The frontmost face under a canvas pixel: { mesh, face, dist } or null.
  pickSurfaceFace(px, py) {
    if (!this.app.currentMesh) return null;
    const w = this.app.renderer.domElement.clientWidth;
    const h = this.app.renderer.domElement.clientHeight;
    this.app.mouse.x = (px / w) * 2 - 1;
    this.app.mouse.y = -(py / h) * 2 + 1;
    this.app.raycaster.setFromCamera(this.app.mouse, this.app.camera);
    const hits = this.app.raycaster.intersectObject(this.app.currentMesh, true);
    if (!hits.length || hits[0].faceIndex == null) return null;
    return { mesh: hits[0].object, face: hits[0].faceIndex, dist: hits[0].distance };
  }

  // Distance from the camera to the frontmost mesh surface at a canvas pixel,
  // or null on a miss. Anchors paint gestures to the surface under the cursor.
  pickSurfaceDepth(px, py) {
    if (!this.app.currentMesh) return null;
    const w = this.app.renderer.domElement.clientWidth;
    const h = this.app.renderer.domElement.clientHeight;
    this.app.mouse.x = (px / w) * 2 - 1;
    this.app.mouse.y = -(py / h) * 2 + 1;
    this.app.raycaster.setFromCamera(this.app.mouse, this.app.camera);
    const hits = this.app.raycaster.intersectObject(this.app.currentMesh, true);
    return hits.length ? hits[0].distance : null;
  }

  // Candidate faces a paint gesture may touch: for remove, the pending set;
  // for add, visible (in-frustum, front-facing) faces not already selected.
  paintCandidates(intent) {
    if (intent === "remove") return this.app.pending ? this.app.pending.selected : null;
    if (!this.app.currentMesh) return null;
    const cam = this.app.camera.position;
    this.app.camera.updateMatrixWorld();
    const pv = new THREE.Matrix4().multiplyMatrices(
      this.app.camera.projectionMatrix,
      this.app.camera.matrixWorldInverse
    );
    const frustum = new THREE.Frustum().setFromProjectionMatrix(pv);
    const out = new Map();
    const va = new THREE.Vector3(), vb = new THREE.Vector3(), vc = new THREE.Vector3();
    const c = new THREE.Vector3(), n = new THREE.Vector3(), e1 = new THREE.Vector3(), e2 = new THREE.Vector3();
    let budget = 60000; // bound per-move projection cost
    this.app.currentMesh.traverse((mesh) => {
      if (!mesh.isMesh || budget <= 0) return;
      const pos = mesh.geometry.getAttribute("position");
      const index = mesh.geometry.index;
      const faceCount = index ? index.count / 3 : pos.count / 3;
      const sel = this.app.pending && this.app.pending.selected.get(mesh);
      const vi = (f, k) => (index ? index.getX(f * 3 + k) : f * 3 + k);
      for (let f = 0; f < faceCount; f++) {
        if (budget <= 0) break;
        if (sel && sel.has(f)) continue;
        va.fromBufferAttribute(pos, vi(f, 0)).applyMatrix4(mesh.matrixWorld);
        vb.fromBufferAttribute(pos, vi(f, 1)).applyMatrix4(mesh.matrixWorld);
        vc.fromBufferAttribute(pos, vi(f, 2)).applyMatrix4(mesh.matrixWorld);
        c.copy(va).add(vb).add(vc).multiplyScalar(1 / 3);
        if (!frustum.containsPoint(c)) continue;
        n.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va));
        if (n.dot(e1.subVectors(c, cam)) >= 0) continue; // back-facing → skip
        let s = out.get(mesh);
        if (!s) { s = new Set(); out.set(mesh, s); }
        s.add(f);
        budget--;
      }
    });
    return out;
  }
}
