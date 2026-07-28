import * as THREE from "three";
import { LABEL_CLASSES } from "./Labels.js";

// One-item-at-a-time verification queue. The reviewer sees one labeled thing
// framed by an orbit camera and answers with a verb: Correct / Wrong class /
// Flag / Skip.
//
// LOD strategy: the entire base mesh stays visible (it's geometry-cheap — the
// "low-res" GLB carries full geometry with small textures, so distant context
// costs almost nothing), and only the item's own tiles get high-res textures.
// The next item's tiles are prefetched so advancing feels instant.
//
// Queue items come from LabelManager today (human-seeded labels); the same
// UI reviews auto-generated proposals later — only the source changes.

const ELEVATION = THREE.MathUtils.degToRad(38); // viewing angle above horizon
const FRAME_MARGIN = 1.6; // >1 leaves surroundings in frame around the item
const MIN_DISTANCE = 1.5;
const MAX_DISTANCE = 90;
const TWEEN_MS = 450;

export class ReviewMode {
  constructor({ camera, orbit, labels, streamer, ui, onChange, onExit, onItemShown, onCorrect, onReclass }) {
    this.camera = camera;
    this.orbit = orbit;
    this.labels = labels;
    this.streamer = streamer; // may be null while the high-res GLB is still fetching
    this.ui = ui;
    this.onChange = onChange || (() => {});
    this.onExit = onExit || (() => {});
    this.onItemShown = onItemShown || (() => {}); // item, or null when complete
    this.onCorrect = onCorrect || null; // interceptor: dirty-state saves
    this.onReclass = onReclass || null; // interceptor: returns true if handled

    this.active = false;
    this.queue = [];
    this.index = 0;
    this.stats = null;
    this.tween = null;

    this.bindUI();
  }

  bindUI() {
    if (!this.ui) return; // headless tests
    // Exit is reached via the top Explore/Review toggle; the card has no ✕.
    if (this.ui.exit) this.ui.exit.addEventListener("click", () => this.exit());
    this.ui.correct.addEventListener("click", () => {
      if (this.onCorrect && this.onCorrect()) return;
      this.correct();
    });
    this.ui.flag.addEventListener("click", () => this.flag());
    this.ui.skip.addEventListener("click", () => this.skip());
    this.ui.wrong.addEventListener("click", () =>
      this.ui.reclass.classList.toggle("active")
    );
    for (const cls of LABEL_CLASSES) {
      const b = document.createElement("button");
      b.className = "class-btn";
      b.style.setProperty("--chip", cls.color);
      b.textContent = cls.name;
      b.addEventListener("click", () => {
        this.ui.reclass.classList.remove("active");
        if (this.onReclass && this.onReclass(cls.id)) return;
        this.reclass(cls.id);
      });
      this.ui.reclass.appendChild(b);
    }
  }

  // --- lifecycle -------------------------------------------------------------

  enter() {
    if (!this.labels || !this.labels.list.length) return false;
    this.active = true;
    this.stats = { confirmed: 0, reclassed: 0, flagged: 0, skipped: 0 };
    this.buildQueue();
    this.index = 0;
    if (this.ui) {
      this.ui.hud.classList.add("active");
      this.ui.actions.classList.add("active");
      this.setActionsVisible(true);
    }
    this.show(0);
    return true;
  }

  exit() {
    if (!this.active) return;
    this.active = false;
    const cur = this.queue[this.index];
    if (cur) this.labels.emphasize(cur.label.id, false);
    if (this.streamer) this.streamer.setReviewOrbit(false); // back to explore proximity
    this.labels.setOverlaysVisible(() => true);
    this.tween = null;
    if (this.ui) {
      this.ui.hud.classList.remove("active");
      this.ui.actions.classList.remove("active");
      this.ui.reclass.classList.remove("active");
    }
    this.onExit();
  }

  // --- queue -----------------------------------------------------------------

  // Greedy nearest-neighbour ordering from the camera: consecutive items sit
  // near each other, so they share tiles and transitions stay cheap. (Later:
  // order by model uncertainty instead.)
  buildQueue() {
    const items = this.labels.list.map((label) => {
      const bbox = this.labels.worldBBoxOf(label);
      return { label, bbox, center: bbox.getCenter(new THREE.Vector3()) };
    });
    const remaining = items.slice();
    const ordered = [];
    let pos = this.camera.position;
    while (remaining.length) {
      let best = 0;
      let bestD = Infinity;
      for (let i = 0; i < remaining.length; i++) {
        const d = remaining[i].center.distanceToSquared(pos);
        if (d < bestD) {
          bestD = d;
          best = i;
        }
      }
      const [item] = remaining.splice(best, 1);
      ordered.push(item);
      pos = item.center;
    }
    this.queue = ordered;
  }

  cur() {
    return this.active ? this.queue[this.index] : null;
  }

  // After an in-review boundary edit: recompute the item's framing data from
  // its (mutated-in-place) label and re-present it.
  refreshCurrentItem() {
    const item = this.cur();
    if (!item) return;
    item.bbox = this.labels.worldBBoxOf(item.label);
    item.center = item.bbox.getCenter(new THREE.Vector3());
    this.show(this.index);
  }

  // The item under review was deleted: drop it and present the next.
  removeCurrentItem() {
    if (!this.active) return;
    this.queue.splice(this.index, 1);
    this.show(this.index);
  }

  itemTileSet(item) {
    return new Set(item.label.tiles.map((t) => t.t));
  }

  // --- presentation ----------------------------------------------------------

  show(i) {
    if (i >= this.queue.length) {
      this.complete();
      return;
    }
    const prev = this.queue[this.index];
    if (prev && prev !== this.queue[i]) this.labels.emphasize(prev.label.id, false);

    this.index = i;
    const item = this.queue[i];

    this.applyFocus(item);
    this.labels.setOverlaysVisible((l) => l.id === item.label.id);
    this.labels.emphasize(item.label.id, true);
    this.frame(item);

    if (this.ui) {
      const cls = LABEL_CLASSES.find((c) => c.id === item.label.class);
      this.ui.progress.textContent = `${i + 1} of ${this.queue.length}`;
      this.ui.klass.textContent = cls ? cls.name : item.label.class;
      this.ui.meta.textContent = `${item.label.faceCount.toLocaleString()} faces`;
      this.ui.reclass.classList.remove("active");
      if (cls && this.ui.classHero) {
        this.ui.classHero.style.setProperty("--cls", cls.color);
      }
    }
    this.onItemShown(item);
  }

  // Streaming: enhance whatever is framed on screen (pick-driven, same as
  // explore) rather than pinning only the item's own atlas pages — so the
  // item AND its surrounding context sharpen, not just the label's tiles.
  applyFocus() {
    if (!this.streamer) return; // base mesh alone until the high-res GLB lands
    this.streamer.setReviewOrbit(true);
  }

  frame(item) {
    const center = item.center;
    const sphere = item.bbox.getBoundingSphere(new THREE.Sphere());
    const radius = Math.max(sphere.radius, 1);

    // Effective FOV accounts for portrait phones (horizontal is the limit).
    const vFov = THREE.MathUtils.degToRad(this.camera.fov);
    const hFov = 2 * Math.atan(Math.tan(vFov / 2) * this.camera.aspect);
    const fov = Math.min(vFov, hFov);
    const dist = THREE.MathUtils.clamp(
      (radius / Math.tan(fov / 2)) * FRAME_MARGIN,
      MIN_DISTANCE,
      MAX_DISTANCE
    );

    // Keep the current azimuth so consecutive items don't spin the world.
    const off = this.camera.position.clone().sub(center);
    off.y = 0;
    const az = off.lengthSq() > 1e-4 ? Math.atan2(off.z, off.x) : Math.PI / 4;

    const dest = new THREE.Vector3(
      center.x + dist * Math.cos(ELEVATION) * Math.cos(az),
      center.y + dist * Math.sin(ELEVATION),
      center.z + dist * Math.cos(ELEVATION) * Math.sin(az)
    );

    this.tween = {
      t0: performance.now(),
      p0: this.camera.position.clone(),
      p1: dest,
      g0: this.orbit.target.clone(),
      g1: center.clone(),
    };
  }

  // Called every frame from the main loop while review mode is active.
  updateFrame() {
    if (this.tween) {
      const k = Math.min(1, (performance.now() - this.tween.t0) / TWEEN_MS);
      const s = k * k * (3 - 2 * k); // smoothstep
      this.camera.position.lerpVectors(this.tween.p0, this.tween.p1, s);
      this.orbit.target.lerpVectors(this.tween.g0, this.tween.g1, s);
      if (k >= 1) this.tween = null;
    }
    this.orbit.update();
  }

  // --- verbs -------------------------------------------------------------------

  correct() {
    const item = this.cur();
    if (!item) return;
    this.labels.setConfidence(item.label.id, "confirmed");
    this.stats.confirmed++;
    this.onChange();
    this.show(this.index + 1);
  }

  reclass(classId) {
    const item = this.cur();
    if (!item) return;
    this.labels.setClass(item.label.id, classId);
    this.labels.setConfidence(item.label.id, "confirmed");
    this.stats.reclassed++;
    this.onChange();
    this.show(this.index + 1);
  }

  flag() {
    const item = this.cur();
    if (!item) return;
    this.labels.setConfidence(item.label.id, "flagged");
    this.stats.flagged++;
    this.onChange();
    this.show(this.index + 1);
  }

  skip() {
    if (!this.cur()) return;
    this.stats.skipped++;
    this.show(this.index + 1);
  }

  complete() {
    const last = this.queue[this.queue.length - 1];
    if (last) this.labels.emphasize(last.label.id, false);
    this.index = this.queue.length;
    this.onItemShown(null);
    if (this.ui) {
      const s = this.stats;
      // The class chip hides on completion, so the summary lives in the
      // always-visible progress + meta fields (compact glyphs to fit the pill).
      this.ui.progress.textContent = "Done";
      this.ui.klass.textContent = "";
      this.ui.meta.textContent = `✓ ${s.confirmed}  ⟳ ${s.reclassed}  ⚑ ${s.flagged}  → ${s.skipped}`;
      this.setActionsVisible(false);
    }
  }

  setActionsVisible(on) {
    if (!this.ui) return;
    this.ui.verbs.style.display = on ? "" : "none";
    if (this.ui.tools) this.ui.tools.style.display = on ? "" : "none";
    if (this.ui.classHero) this.ui.classHero.style.display = on ? "" : "none";
    if (!on) this.ui.reclass.classList.remove("active");
  }
}
