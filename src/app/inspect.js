import { Terrain } from "../Terrain.js";
import { classifyRegion, defaultClearance } from "../AutoTagger.js";
import { LABEL_CLASSES } from "../Labels.js";

// Explore classifier inspector: tapping a surface shows the class the
// auto-tagger WOULD assign it, with its reasoning (geom class, height above
// local terrain, colour). Uses the SAME classifyRegion the auto-tagger runs,
// so what you see is what it would tag. Terrain (DTM) is built lazily on first
// inspection and cached. Mixed onto MeshExplorer.prototype (`this` is the app).
export const inspectMixin = {
  // Bare-earth terrain for the current mesh, built once and cached.
  getTerrain() {
    if (!this.terrain && this.currentMesh) {
      try {
        this.terrain = Terrain.build(this.currentMesh);
      } catch (e) {
        console.warn("terrain build failed", e);
      }
    }
    return this.terrain;
  },

  // Show the classifier's verdict for the current selection: the SAME decision
  // auto-tag makes, with its reasoning, so misclassifications are diagnosable
  // by tapping the offending surface.
  updateInspector() {
    const el = document.getElementById("inspect");
    if (!el) return;
    if (!this.inspectMode || this.mode !== "explore" || !this.pending || !this.pending.selected.size) {
      el.classList.remove("active");
      return;
    }
    const terrain = this.getTerrain();
    const clearance = defaultClearance(terrain);
    const info = classifyRegion({
      selector: this.selector,
      labels: this.labels,
      terrain,
      targetClass: this.pending.targetClass,
      selected: this.pending.selected,
      clearance,
    });
    const cls = LABEL_CLASSES.find((c) => c.id === info.classId);
    const h = info.heightAbove;
    document.getElementById("insp-geom").textContent = info.geomClass || "—";
    document.getElementById("insp-terrain").textContent =
      h == null
        ? "n/a"
        : `${h >= 0 ? "+" : ""}${h.toFixed(2)}u / ${clearance.toFixed(2)} → ${h < clearance ? "near ground" : "elevated"}`;
    document.getElementById("insp-colour").textContent = info.greenish ? "green → veg" : "not green";
    document.getElementById("insp-dot").style.background = cls ? cls.color : "#888";
    document.getElementById("insp-class").textContent = cls ? cls.name : info.classId;
    el.classList.add("active");
  },
};
