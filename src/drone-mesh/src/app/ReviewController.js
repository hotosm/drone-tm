import * as THREE from "three";
import { OrbitControls } from "three/examples/jsm/controls/OrbitControls.js";
import { LABEL_CLASSES } from "../Labels.js";
import { ReviewMode } from "../ReviewMode.js";

// Review-mode coordinator. OWNS the sub-mode flags (reviewAdjust,
// reviewAdjusting, pendingDirty); reaches the app for shared state and the
// ReviewMode engine (app.review) + orbit camera it creates. `this` is the
// controller, `this.app` is the MeshExplorer.
export class ReviewController {
  constructor(app) {
    this.app = app;
    this.reviewAdjust = false; // an item is armed for editing
    this.reviewAdjusting = false; // the editing tools are revealed
    this.pendingDirty = false; // the armed item has unsaved edits
  }

  armReviewItem(item) {
    const app = this.app;
    this.quietDisarm();
    const adjustBtn = document.getElementById("ra-adjust");
    if (!item) {
      this.reviewAdjust = false; // queue complete
      this.setReviewAdjusting(false);
      if (adjustBtn) adjustBtn.style.display = "none";
      return;
    }
    if (adjustBtn) adjustBtn.style.display = "";
    this.reviewAdjust = true;
    app.editingLabelId = item.label.id;
    app.labels.setOverlayVisible(item.label.id, false); // live highlight replaces it
    app.pending = {
      selected: app.labels.decodeSelection(item.label),
      targetClass: item.label.geomClass || "roof-flat",
      clicks: 1,
    };
    app.pending.faceCount = item.label.faceCount;
    this.pendingDirty = false;
    app.labelingCtl.pickClass(item.label.class);
    app.labelingCtl.pickConfidence(item.label.confidence);
    app.selector.showFaces(app.pending.selected);
    this.updateReviewSheet();
    this.setReviewAdjusting(false); // each item starts as clean triage
  }

  // Toggle the editing sub-mode: reveals the shared tool bar + focus cluster
  // (floated above the review card) so a boundary can be tidied. Off by
  // default so a straight Confirm/Skip pass stays uncluttered.
  setReviewAdjusting(on) {
    this.reviewAdjusting = on;
    document.body.classList.toggle("adjusting", on);
    const btn = document.getElementById("ra-adjust");
    if (btn) btn.classList.toggle("active", on);
    this.app.chrome.showToolbar(on);
    this.app.chrome.showDock(on);
    if (!on) this.app.chrome.setTool("navigate"); // leaving adjust returns to orbit-only
  }

  quietDisarm() {
    const app = this.app;
    app.chrome.setIntent("add"); // erase off for the next item; keep current tool
    if (app.controls && app.controls.orbitTarget) {
      app.controls.orbitTarget = null;
      app.controls.syncFromCamera();
    }
    // Don't force the previous item's overlay back on — ReviewMode.show() has
    // already set overlay visibility for the new item (only the current one),
    // and re-showing here leaves the just-skipped item highlighted in its tag
    // colour. Review's setOverlaysVisible / exit restore is the authority.
    app.editingLabelId = null;
    app.pending = null;
    app.pendingHistory = [];
    this.pendingDirty = false;
    if (app.selector) app.selector.clearHighlight();
    app.chrome.showDock(false);
  }

  updateReviewSheet() {
    const app = this.app;
    if (!app.review || !app.review.ui) return;
    const ui = app.review.ui;
    const dirty = !!this.pendingDirty;
    document.getElementById("ra-discard").style.display = dirty ? "" : "none";
    document.getElementById("ra-delete").style.display = "";
    ui.flag.style.display = dirty ? "none" : "";
    ui.skip.style.display = dirty ? "none" : "";
    ui.correct.textContent = dirty ? "✓ Save changes" : "✓ Confirm";
    app.chrome.syncDock();
    const cls = LABEL_CLASSES.find((c) => c.id === app.labelingCtl.pickedClass);
    if (cls) {
      ui.klass.textContent = cls.name;
      ui.classHero.style.setProperty("--cls", cls.color);
      document.getElementById("ra-class-dot").style.background = cls.color;
    }
    if (app.pending) {
      ui.meta.textContent = `${app.pending.faceCount.toLocaleString()} faces`;
    }
  }

  // Confirm button: clean = verdict, dirty = save the edit (and count it).
  handleReviewConfirm() {
    const app = this.app;
    if (!this.pendingDirty) return false; // let ReviewMode.correct() run
    app.labels.update(app.editingLabelId, {
      selected: app.pending.selected,
      classId: app.labelingCtl.pickedClass,
      confidence: "confirmed",
    });
    this.pendingDirty = false;
    app.editingLabelId = null; // updated overlay repaints visible
    app.review.correct(); // advance; next item re-arms via onItemShown
    return true;
  }

  // Class chip: clean = classic reclass verb (advance); dirty = just set the
  // class, it saves with the rest of the edit.
  handleReviewReclass(classId) {
    this.app.labelingCtl.pickClass(classId);
    if (!this.pendingDirty) return false; // default reclass+advance
    this.updateReviewSheet();
    return true;
  }

  enterReviewMode() {
    const app = this.app;
    if (app.mode === "review") return;
    if (!app.labels || !app.labels.list.length) return;

    app.selectionCtl.cancelPendingSelection();

    if (!app.orbit) {
      app.orbit = new OrbitControls(app.camera, app.renderer.domElement);
      app.orbit.enableDamping = true;
      app.orbit.dampingFactor = 0.12;
      app.orbit.maxPolarAngle = Math.PI * 0.49; // stay above the horizon
      app.orbit.enabled = false;
    }
    if (!app.review) {
      app.review = new ReviewMode({
        camera: app.camera,
        orbit: app.orbit,
        labels: app.labels,
        streamer: app.streamer,
        ui: {
          // one compact card; the shared tool bar is revealed only on Adjust.
          hud: document.getElementById("review-actions"),
          progress: document.getElementById("rh-progress"),
          klass: document.getElementById("rh-class"),
          classHero: document.getElementById("ra-class"),
          meta: document.getElementById("rh-meta"),
          exit: null, // no ✕ on the card; Explore/Review toggle exits
          actions: document.getElementById("review-actions"),
          reclass: document.getElementById("ra-reclass"),
          verbs: document.getElementById("ra-verbs"), // verb row, hidden on complete
          tools: null, // tool bar is the shared #toolbar, revealed via Adjust
          correct: document.getElementById("ra-correct"),
          wrong: document.getElementById("ra-class"), // the class chip toggles the picker
          flag: document.getElementById("ra-flag"),
          skip: document.getElementById("ra-skip"),
        },
        onChange: () => app.labelingCtl.renderLabelList(),
        onExit: () => this.handleReviewExit(),
        onItemShown: (item) => this.armReviewItem(item),
        onCorrect: () => this.handleReviewConfirm(),
        onReclass: (classId) => this.handleReviewReclass(classId),
      });
    }
    // Refresh refs — labels is rebuilt per map, streamer arrives after load.
    app.review.labels = app.labels;
    app.review.streamer = app.streamer;

    app.mode = "review";
    document.body.classList.add("review-mode"); // raises the tool bar above the verbs
    app.controls.enabled = false;
    app.orbit.enabled = true;
    app.chrome.setTool("navigate"); // orbit to inspect; pick a tool to adjust
    // Seed the orbit target with the current view direction so the first
    // frame doesn't snap toward a stale target.
    const dir = new THREE.Vector3();
    app.camera.getWorldDirection(dir);
    app.orbit.target.copy(app.camera.position).addScaledVector(dir, 10);

    app.labelingCtl.ui.card.classList.remove("active");
    document.getElementById("info").classList.remove("active");
    app.chrome.showToolbar(false); // tools stay hidden until Adjust
    app.chrome.syncModeToggle();

    if (!app.review.enter()) this.handleReviewExit();
  }

  handleReviewExit() {
    const app = this.app;
    this.quietDisarm();
    this.reviewAdjust = false;
    this.reviewAdjusting = false;
    app.mode = "explore";
    document.body.classList.remove("review-mode", "adjusting");
    if (app.orbit) app.orbit.enabled = false;
    app.controls.enabled = true;
    app.controls.syncFromCamera();
    app.chrome.setTool("navigate"); // resets FP paintMode for explore
    app.chrome.showToolbar(true);
    app.chrome.syncModeToggle();
    app.labelingCtl.renderLabelList();
  }
}
