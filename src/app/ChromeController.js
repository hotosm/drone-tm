import * as THREE from "three";

// Tool bar + editing chrome, as a controller that OWNS its state (the active
// tool + add/remove intent) and reaches the app coordinator for shared state
// (mode, camera, controls, selection). First of the app-as-coordinator
// controllers: `this` is the controller, `this.app` is the MeshExplorer.
export class ChromeController {
  constructor(app) {
    this.app = app;
    // navigate = camera only (no tagging); tap/brush/lasso = tagging tools.
    // Default navigate so a tap never tags by accident — user opts in.
    this.editTool = "navigate";
    // Intent axis: add / remove (the erase modifier).
    this.editIntent = "add";
  }

  setIntent(intent) {
    this.editIntent = intent;
    if (this.app.paint) this.app.paint.setIntent(intent);
    this.syncToolbar();
  }

  // Tool selection also governs the camera: tap leaves navigation free
  // (you move between clicks); brush/lasso lock the active controller so the
  // gesture is ours. Reset to tap whenever a selection ends.
  setTool(tool) {
    this.editTool = tool;
    const painting = tool === "brush" || tool === "lasso";
    if (this.app.paint) {
      this.app.paint.setIntent(this.editIntent);
      this.app.paint.setTool(painting ? tool : "tap");
    }
    // Never fully lock the camera while painting: single finger / mouse paints,
    // but TWO fingers still navigate (and PaintTools ignores multi-touch). So
    // paint tools coexist with nav — you don't have to switch to Move to pan.
    if (this.app.mode === "review") {
      if (this.app.orbit) {
        this.app.orbit.enabled = true;
        // one-finger / left-drag = paint when a tool is active (so orbit
        // ignores them); two-finger + right/middle mouse still dolly/pan.
        this.app.orbit.touches = {
          ONE: painting ? null : THREE.TOUCH.ROTATE,
          TWO: THREE.TOUCH.DOLLY_PAN,
        };
        this.app.orbit.mouseButtons = {
          LEFT: painting ? null : THREE.MOUSE.ROTATE,
          MIDDLE: THREE.MOUSE.DOLLY,
          RIGHT: THREE.MOUSE.PAN,
        };
      }
    } else if (this.app.controls) {
      this.app.controls.enabled = true;
      this.app.controls.paintMode = painting;
    }
    this.syncToolbar();
  }

  focusSelection(dir) {
    const app = this.app;
    if (!app.pending || !app.pending.selected.size) return;
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    for (const [mesh, faces] of app.pending.selected) {
      const pos = mesh.geometry.getAttribute("position");
      const index = mesh.geometry.index;
      for (const f of faces) {
        for (let k = 0; k < 3; k++) {
          const idx = index ? index.getX(f * 3 + k) : f * 3 + k;
          box.expandByPoint(v.fromBufferAttribute(pos, idx).applyMatrix4(mesh.matrixWorld));
        }
      }
    }
    if (box.isEmpty()) return;
    const center = box.getCenter(new THREE.Vector3());
    const radius = Math.max(box.getBoundingSphere(new THREE.Sphere()).radius, 1);
    const fov = THREE.MathUtils.degToRad(app.camera.fov);
    const dist = (radius / Math.tan(fov / 2)) * 1.5;
    const axis = {
      top: new THREE.Vector3(0.001, 1, 0.001),
      front: new THREE.Vector3(0, 0.15, 1),
      side: new THREE.Vector3(1, 0.15, 0),
    }[dir] || new THREE.Vector3(0.3, 0.6, 1);
    axis.normalize();
    app.camera.position.copy(center).addScaledVector(axis, dist);
    app.camera.lookAt(center);
    if (app.mode === "review" && app.orbit) {
      app.orbit.target.copy(center);
    } else if (app.controls) {
      app.controls.syncFromCamera();
    }
  }

  syncDock() {
    this.syncToolbar();
  }

  // showDock(on): on = a selection is being edited. Reveals the refine/intent
  // tools + focus-view cluster and clears the status card out of the way.
  showDock(on) {
    const bar = document.getElementById("toolbar");
    if (bar) bar.classList.toggle("editing", on);
    const fg = document.getElementById("focus-group");
    if (fg) {
      fg.classList.toggle("visible", on);
      if (!on) fg.classList.remove("open");
    }
    const card = document.getElementById("labels-card");
    if (card) {
      if (on) card.classList.remove("active");
      else if (this.app.mode === "explore" && this.app.labels) card.classList.add("active");
    }
    this.syncToolbar();
  }

  showToolbar(on) {
    const bar = document.getElementById("toolbar");
    if (bar) bar.classList.toggle("visible", on);
  }

  syncToolbar() {
    const bar = document.getElementById("toolbar");
    if (!bar) return;
    bar.querySelectorAll("[data-tool]").forEach((b) =>
      b.classList.toggle("active", b.dataset.tool === this.editTool)
    );
    // Erase = the remove intent, shown as an on/off modifier (not a tool).
    const erasing = this.editIntent === "remove";
    bar.classList.toggle("erasing", erasing);
    const erase = document.getElementById("tb-erase");
    if (erase) erase.classList.toggle("active", erasing);
    const undo = document.getElementById("tb-undo");
    if (undo) undo.disabled = this.app.pendingHistory.length === 0;
  }

  setupToolbar() {
    const app = this.app;
    const bar = document.getElementById("toolbar");
    if (!bar) return;
    bar.querySelectorAll("[data-tool]").forEach((b) =>
      b.addEventListener("click", () => this.setTool(b.dataset.tool))
    );
    document.getElementById("tb-erase").addEventListener("click", () =>
      this.setIntent(this.editIntent === "add" ? "remove" : "add")
    );
    document.getElementById("tb-undo").addEventListener("click", () => app.selectionCtl.undoPending());
    document.getElementById("tb-grow").addEventListener("click", () => app.selectionCtl.growPending());
    document.getElementById("tb-shrink").addEventListener("click", () => app.selectionCtl.shrinkPending());

    // top-left: focus-view cluster (single icon → expandable menu) + info
    const focusGroup = document.getElementById("focus-group");
    document.getElementById("focus-toggle").addEventListener("click", () =>
      focusGroup.classList.toggle("open")
    );
    document.querySelectorAll("#focus-group [data-view3d]").forEach((b) =>
      b.addEventListener("click", () => {
        this.focusSelection(b.dataset.view3d);
        focusGroup.classList.remove("open"); // collapse after picking an angle
      })
    );
    document.getElementById("btn-info").addEventListener("click", () =>
      document.getElementById("info").classList.toggle("active")
    );

    // review: reveal/hide the editing tools for the current item
    document.getElementById("ra-adjust").addEventListener("click", () =>
      app.reviewCtl.setReviewAdjusting(!app.reviewCtl.reviewAdjusting)
    );

    // top-center: Explore / Review
    document.getElementById("mode-explore").addEventListener("click", () => {
      if (app.mode === "review" && app.review) app.review.exit();
    });
    document.getElementById("mode-review").addEventListener("click", () => {
      if (app.mode === "explore") app.reviewCtl.enterReviewMode();
    });

    // top-right: tucked utilities menu
    const menu = document.getElementById("labels-menu");
    document.getElementById("labels-menu-btn").addEventListener("click", () =>
      menu.classList.toggle("open")
    );

    // Explore classifier inspector toggle: shows what auto-tag would call the
    // tapped surface (app/inspect.js). Reflects + flips app.inspectMode.
    const inspBtn = document.getElementById("labels-inspect");
    if (inspBtn) {
      inspBtn.classList.toggle("on", this.app.inspectMode);
      inspBtn.addEventListener("click", () => {
        this.app.inspectMode = !this.app.inspectMode;
        inspBtn.classList.toggle("on", this.app.inspectMode);
        this.app.updateInspector();
      });
    }
  }

  syncModeToggle() {
    const ex = document.getElementById("mode-explore");
    const rv = document.getElementById("mode-review");
    if (ex) ex.classList.toggle("active", this.app.mode === "explore");
    if (rv) rv.classList.toggle("active", this.app.mode === "review");
  }
}
