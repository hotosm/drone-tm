import { LABEL_CLASSES, CONFIDENCE_LEVELS } from "../Labels.js";
import { PaintTools } from "../PaintTools.js";

// Labeling coordinator. OWNS the commit-sheet UI refs + current picks (ui,
// pickedClass, pickedConfidence) and the view-filter state (viewMode,
// isolatedClass). Reaches the app for shared state (pending, labels, selector)
// and sibling controllers. `this` is the controller, `this.app` the MeshExplorer.
export class LabelingController {
  constructor(app) {
    this.app = app;
    this.ui = null;
    this.pickedClass = null;
    this.pickedConfidence = "confirmed";
    this.viewMode = "hidden";
    this.isolatedClass = null;
  }

  enterEditLabel(label) {
    const app = this.app;
    app.editingLabelId = label.id;
    app.labels.setOverlayVisible(label.id, false); // pending highlight replaces it
    app.pendingHistory = [];
    app.pending = {
      selected: app.labels.decodeSelection(label),
      targetClass: label.geomClass || "roof-flat",
      clicks: 1,
    };
    app.selectionCtl.refreshPending();
    // panel opens via refreshPending; preselect the label's own values
    this.pickClass(label.class);
    this.pickConfidence(label.confidence);
  }

  exitEditState() {
    if (this.app.editingLabelId && this.app.labels) {
      this.app.labels.setOverlayVisible(this.app.editingLabelId, true);
    }
    this.app.editingLabelId = null;
  }

  initLabelUI() {
    const app = this.app;
    this.ui = {
      panel: document.getElementById("label-panel"),
      summary: document.getElementById("lp-summary"),
      classGrid: document.getElementById("lp-classgrid"),
      classPill: document.getElementById("lp-class"),
      classDot: document.getElementById("lp-class-dot"),
      className: document.getElementById("lp-class-name"),
      confBtn: document.getElementById("lp-conf"),
      confDot: document.getElementById("lp-conf-dot"),
      confName: document.getElementById("lp-conf-name"),
      deleteBtn: document.getElementById("lp-delete"),
      save: document.getElementById("lp-save"),
      cancel: document.getElementById("lp-cancel"),
      card: document.getElementById("labels-card"),
      count: document.getElementById("labels-count"),
      export: document.getElementById("labels-export"),
      clear: document.getElementById("labels-clear"),
      autoBtn: document.getElementById("labels-auto"),
    };
    this.pickedClass = null;
    this.pickedConfidence = "confirmed";

    // class picker lives in a popover; the pill in the bar opens it
    for (const cls of LABEL_CLASSES) {
      const b = document.createElement("button");
      b.className = "class-btn";
      b.dataset.cls = cls.id;
      b.style.setProperty("--chip", cls.color);
      b.textContent = cls.name;
      b.addEventListener("click", () => {
        this.pickClass(cls.id);
        this.ui.classGrid.classList.remove("open");
      });
      this.ui.classGrid.appendChild(b);
    }
    this.ui.classPill.addEventListener("click", () =>
      this.ui.classGrid.classList.toggle("open")
    );
    // confidence is a single pill that cycles confirmed → unsure → flagged
    this.ui.confBtn.addEventListener("click", () => {
      const order = CONFIDENCE_LEVELS.map((c) => c.id);
      const i = order.indexOf(this.pickedConfidence);
      this.pickConfidence(order[(i + 1) % order.length]);
    });

    // Paint tools: lasso (mouse) / brush (touch), add OR remove per intent.
    // Reads candidates live and applies hits through applyPaint.
    app.paint = new PaintTools({
      domElement: app.renderer.domElement,
      container: document.getElementById("canvas-container"),
      camera: app.camera,
      getCandidates: (intent) => app.selectionCtl.paintCandidates(intent),
      onGestureStart: () => app.selectionCtl.pushPendingHistory(),
      onApply: (intent, map) => app.selectionCtl.applyPaint(intent, map),
      onBrush: (px, py, radius) => app.selectionCtl.onBrush(px, py, radius),
      pickDepth: (px, py) => app.selectionCtl.pickSurfaceDepth(px, py),
      pickFace: (px, py) => app.selectionCtl.pickSurfaceFace(px, py),
    });
    app.chrome.setupToolbar();

    this.ui.deleteBtn.addEventListener("click", () => {
      if (app.editingLabelId && app.labels && confirm("Delete this label?")) {
        const id = app.editingLabelId;
        app.editingLabelId = null; // overlay is going away — skip restore
        app.labels.remove(id);
        app.selectionCtl.cancelPendingSelection();
        this.renderLabelList();
      }
    });

    // review-sheet controls that live outside ReviewMode's own bindings
    const bindTool = (id, fn) => document.getElementById(id).addEventListener("click", fn);
    bindTool("ra-discard", () => app.selectionCtl.cancelPendingSelection());
    bindTool("ra-delete", () => {
      if (!app.editingLabelId || !app.labels) return;
      if (!confirm("Delete this label?")) return;
      const id = app.editingLabelId;
      app.editingLabelId = null; // gone — no overlay to restore
      app.pending = null;
      app.reviewCtl.pendingDirty = false;
      if (app.selector) app.selector.clearHighlight();
      app.labels.remove(id);
      if (app.review) app.review.removeCurrentItem();
      this.renderLabelList();
    });
    this.ui.save.addEventListener("click", () => this.saveLabel());
    this.ui.cancel.addEventListener("click", () => app.selectionCtl.cancelPendingSelection());
    this.ui.autoBtn.addEventListener("click", () => {
      document.getElementById("labels-menu").classList.remove("open");
      app.runAutoTag();
    });
    this.ui.export.addEventListener("click", () => {
      document.getElementById("labels-menu").classList.remove("open");
      if (app.labels) app.labels.exportDownload();
    });
    this.ui.clear.addEventListener("click", () => {
      document.getElementById("labels-menu").classList.remove("open");
      if (app.labels && confirm("Delete all labels for this map?")) {
        app.labels.clearAll();
        this.renderLabelList();
      }
    });
    // View switcher: overlays default OFF (clean mesh); user opts into a view.
    this.viewMode = "hidden";
    this.isolatedClass = null;
    document.getElementById("view-modes").addEventListener("click", (event) => {
      const btn = event.target.closest(".view-btn");
      if (!btn) return;
      this.viewMode = btn.dataset.view;
      this.isolatedClass = null;
      this.syncViewUI();
      if (app.labels) {
        app.labels.applyView({ mode: this.viewMode, classId: null });
      }
    });
    const classRow = document.getElementById("view-classes");
    for (const cls of LABEL_CLASSES) {
      const b = document.createElement("button");
      b.className = "class-dot-btn";
      b.title = `Show only ${cls.name}`;
      b.dataset.cls = cls.id;
      b.style.background = cls.color;
      b.addEventListener("click", () => {
        this.isolatedClass = this.isolatedClass === cls.id ? null : cls.id;
        this.syncViewUI();
        if (app.labels) {
          app.labels.applyView({ mode: this.viewMode, classId: this.isolatedClass });
        }
      });
      classRow.appendChild(b);
    }
  }

  syncViewUI() {
    for (const b of document.getElementById("view-modes").children) {
      b.classList.toggle(
        "active",
        !this.isolatedClass && b.dataset.view === this.viewMode
      );
    }
    for (const b of document.getElementById("view-classes").children) {
      b.classList.toggle("active", b.dataset.cls === this.isolatedClass);
    }
  }

  pickClass(id) {
    this.pickedClass = id;
    const cls = LABEL_CLASSES.find((c) => c.id === id);
    if (this.ui.classDot) this.ui.classDot.style.background = cls ? cls.color : "#fff";
    if (this.ui.className) this.ui.className.textContent = cls ? cls.name : id;
    for (const b of this.ui.classGrid.children) {
      b.classList.toggle("active", b.dataset.cls === id);
    }
  }

  pickConfidence(id) {
    this.pickedConfidence = id;
    const conf = CONFIDENCE_LEVELS.find((c) => c.id === id);
    if (this.ui.confDot) this.ui.confDot.style.background = conf ? conf.color : "#fff";
    if (this.ui.confName) this.ui.confName.textContent = conf ? conf.name : id;
  }

  showLabelPanel() {
    const app = this.app;
    if (!this.ui || !app.pending) return;
    const p = app.pending;
    const editing = !!app.editingLabelId;
    this.ui.summary.textContent = `${p.faceCount.toLocaleString()} faces`;
    // Preselect the suggested class on a fresh selection; keep the user's
    // picks while they refine or edit an existing label.
    if (p.clicks === 1 && !editing) {
      this.pickClass(p.suggested);
      this.pickConfidence("confirmed");
    }
    this.ui.deleteBtn.style.display = editing ? "" : "none";
    this.ui.save.textContent = editing ? "Update" : "Save";
    this.ui.classGrid.classList.remove("open"); // bar first; picker on demand
    this.ui.panel.classList.add("active");
    app.chrome.showDock(true);
  }

  saveLabel() {
    const app = this.app;
    if (!app.pending || !app.labels || !this.pickedClass) return;
    const wasEditing = !!app.editingLabelId;
    if (wasEditing) {
      app.labels.update(app.editingLabelId, {
        selected: app.pending.selected,
        classId: this.pickedClass,
        confidence: this.pickedConfidence,
      });
      app.editingLabelId = null; // updated overlay repaints visible
    } else {
      app.labels.add({
        selected: app.pending.selected,
        classId: this.pickedClass,
        confidence: this.pickedConfidence,
        suggested: app.pending.suggested,
        targetClass: app.pending.targetClass,
      });
    }
    app.selectionCtl.cancelPendingSelection();
    // Reveal what was just tagged: if overlays are hidden, flip to Tagged so
    // the new label is visible (don't override a filter the user chose).
    if (app.mode === "explore" && this.viewMode === "hidden") {
      this.viewMode = "all";
      this.syncViewUI();
    }
    this.renderLabelList();
  }

  // The status card is now just a count + coverage + view filters (the big
  // per-label list is gone — it's noise during tagging). Mode toggle owns the
  // Explore/Review switch, so no Review button here.
  renderLabelList() {
    const app = this.app;
    if (!this.ui || !app.labels) return;
    if (app.mode === "review") return; // review owns overlay visibility
    this.ui.card.classList.toggle("active", !app.pending);
    const labels = app.labels.list;
    this.ui.count.textContent = `${labels.length} label${labels.length === 1 ? "" : "s"}`;
    app.labels.applyView({ mode: this.viewMode, classId: this.isolatedClass });
    const covEl = document.getElementById("labels-coverage");
    if (labels.length) {
      const compute = () => {
        covEl.textContent = `${app.labels.coverage().toFixed(0)}% covered`;
      };
      if (window.requestIdleCallback) requestIdleCallback(compute);
      else setTimeout(compute, 50);
    } else {
      covEl.textContent = "";
    }
    // Review is only reachable with something to review.
    const rv = document.getElementById("mode-review");
    if (rv) rv.disabled = !labels.length;
    app.chrome.syncModeToggle();
  }
}
