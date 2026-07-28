import * as THREE from "three";

// Class taxonomy. This is load-bearing for the client's ML endgame — the
// labels this app produces are training data, so the classes need client
// buy-in. Keep it a single editable list; `osm` documents the OpenStreetMap
// tags each class is expected to map onto at export time.
export const LABEL_CLASSES = [
  { id: "building-roof", name: "Roof", color: "#e63946", osm: "building=* / roof:material=*" },
  { id: "building-wall", name: "Wall", color: "#f4a261", osm: "building=* / building:material=*" },
  { id: "road-path", name: "Road / Path", color: "#8d99ae", osm: "highway=* / surface=*" },
  { id: "ground", name: "Ground", color: "#b08968", osm: "landuse=* / surface=*" },
  { id: "vegetation", name: "Vegetation", color: "#2a9d8f", osm: "natural=* / landuse=*" },
  { id: "water-drainage", name: "Water / Drain", color: "#457b9d", osm: "natural=water / waterway=drain" },
  { id: "other", name: "Other", color: "#9b5de5", osm: "" },
];

// Traffic-light review states. They map onto ML data tiers: confirmed feeds
// the training set, unsure goes to a review queue, flagged is weak/discard.
export const CONFIDENCE_LEVELS = [
  { id: "confirmed", name: "Confirmed", color: "#2ecc71" },
  { id: "unsure", name: "Unsure", color: "#f1c40f" },
  { id: "flagged", name: "Flagged", color: "#e74c3c" },
];

// Overlays sit just above the surface to avoid z-fighting, below the active
// selection highlight (renderOrder 999 in SurfaceSelector).
// The fill sits ON the surface — z-fighting is handled by polygonOffset (a
// depth-buffer bias, no world displacement), NOT by pushing geometry along
// the normal. A world offset balloons the overlay off bumpy/steep meshes and
// cracks open seams where adjacent faces point different ways. The outline is
// lifted a hair so the lines stay above the fill.
const OUTLINE_LIFT = 0.004; // ~4mm, minimal
const OVERLAY_POLY_OFFSET = -4; // factor & units; beats base + cluster overlays
const OVERLAY_RENDER_ORDER = 998;
const OVERLAY_OPACITY = 0.45;
const OVERLAY_EMPHASIS_OPACITY = 0.62; // item under review

// Suggested class for a horizontal-up surface: below this fraction of the
// site's height range it reads as ground, above it as a flat roof. A normal
// test alone can't tell those apart. The real fix is the DTM/DSM that ships
// with the photogrammetry run — this is a stopgap prior.
const GROUND_HEIGHT_FRACTION = 0.12;

const STORAGE_VERSION = 1;

// Face-index arrays are stored delta-encoded (sorted, then differences).
// Flood-filled faces are near-contiguous, so deltas are mostly tiny ints —
// roughly 3x smaller in JSON and never larger than the raw list.
function deltaEncode(sortedInts) {
  const out = new Array(sortedInts.length);
  let prev = 0;
  for (let i = 0; i < sortedInts.length; i++) {
    out[i] = sortedInts[i] - prev;
    prev = sortedInts[i];
  }
  return out;
}

function deltaDecode(deltas) {
  const out = new Array(deltas.length);
  let acc = 0;
  for (let i = 0; i < deltas.length; i++) {
    acc += deltas[i];
    out[i] = acc;
  }
  return out;
}

// Quantum for merging overlay boundary-edge endpoints across UV seams and
// tile borders (world scene units, ~4mm) — matches the selector's stitch
// scale so a physically continuous label reads as one clean outline.
const OUTLINE_Q = 0.004;

// Build a world-space overlay for {t, df} records: a translucent fill plus a
// crisp boundary outline (the edges that belong to exactly one selected
// face, quantized so seams/tile-borders don't show as internal lines). The
// outline is a child LineSegments of the fill mesh, so existing code that
// toggles/《colours the fill Mesh keeps working; the outline follows.
function buildFacesMesh(tileMeshes, tiles, colorHex) {
  const positions = [];
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  const n = new THREE.Vector3();

  // edge key -> { count, a:[x,y,z], b:[x,y,z] } over offset world positions
  const edges = new Map();
  const q = (x) => Math.round(x / OUTLINE_Q);
  const addEdge = (p1, p2) => {
    const k1 = `${q(p1[0])},${q(p1[1])},${q(p1[2])}`;
    const k2 = `${q(p2[0])},${q(p2[1])},${q(p2[2])}`;
    // dedup by RAW position (before lift) so shared edges — incl. across
    // seams/tiles — merge; store the lifted endpoints for drawing
    const key = k1 < k2 ? `${k1}|${k2}` : `${k2}|${k1}`;
    const e = edges.get(key);
    if (e) e.count++;
    else edges.set(key, { count: 1, a: p1.lift, b: p2.lift });
  };

  for (const { t, df } of tiles) {
    const mesh = tileMeshes[t];
    if (!mesh) continue;
    const posAttr = mesh.geometry.getAttribute("position");
    const index = mesh.geometry.index;
    const vertIdx = index
      ? (f, c) => index.getX(f * 3 + c)
      : (f, c) => f * 3 + c;

    for (const f of deltaDecode(df)) {
      va.fromBufferAttribute(posAttr, vertIdx(f, 0)).applyMatrix4(mesh.matrixWorld);
      vb.fromBufferAttribute(posAttr, vertIdx(f, 1)).applyMatrix4(mesh.matrixWorld);
      vc.fromBufferAttribute(posAttr, vertIdx(f, 2)).applyMatrix4(mesh.matrixWorld);
      // fill sits on the surface (no displacement → no cracks); polygonOffset
      // handles z-fighting. Only the outline gets a tiny normal lift.
      n.crossVectors(e1.subVectors(vb, va), e2.subVectors(vc, va))
        .normalize()
        .multiplyScalar(OUTLINE_LIFT);
      positions.push(va.x, va.y, va.z, vb.x, vb.y, vb.z, vc.x, vc.y, vc.z);
      const mk = (v) => ({ raw: [v.x, v.y, v.z], lift: [v.x + n.x, v.y + n.y, v.z + n.z] });
      const A = mk(va), B = mk(vb), C = mk(vc);
      addEdge({ 0: A.raw[0], 1: A.raw[1], 2: A.raw[2], lift: A.lift }, { 0: B.raw[0], 1: B.raw[1], 2: B.raw[2], lift: B.lift });
      addEdge({ 0: B.raw[0], 1: B.raw[1], 2: B.raw[2], lift: B.lift }, { 0: C.raw[0], 1: C.raw[1], 2: C.raw[2], lift: C.lift });
      addEdge({ 0: C.raw[0], 1: C.raw[1], 2: C.raw[2], lift: C.lift }, { 0: A.raw[0], 1: A.raw[1], 2: A.raw[2], lift: A.lift });
    }
  }

  if (!positions.length) return null;

  const geom = new THREE.BufferGeometry();
  geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));
  const mat = new THREE.MeshBasicMaterial({
    color: new THREE.Color(colorHex),
    transparent: true,
    opacity: OVERLAY_OPACITY,
    side: THREE.DoubleSide,
    // depthWrite TRUE so the overlay self-occludes: on a hip roof the near
    // slope hides the far slope's overlay instead of both compositing into
    // interleaved bands. polygonOffset keeps it above the base texture.
    depthWrite: true,
    polygonOffset: true,
    polygonOffsetFactor: OVERLAY_POLY_OFFSET,
    polygonOffsetUnits: OVERLAY_POLY_OFFSET,
  });
  const mesh = new THREE.Mesh(geom, mat);
  mesh.renderOrder = OVERLAY_RENDER_ORDER;
  mesh.raycast = () => {}; // overlays must never swallow selection raycasts

  // boundary outline: edges seen exactly once
  const linePos = [];
  for (const e of edges.values()) {
    if (e.count === 1) linePos.push(e.a[0], e.a[1], e.a[2], e.b[0], e.b[1], e.b[2]);
  }
  if (linePos.length) {
    const lgeom = new THREE.BufferGeometry();
    lgeom.setAttribute("position", new THREE.Float32BufferAttribute(linePos, 3));
    const lmat = new THREE.LineBasicMaterial({
      color: new THREE.Color(colorHex),
      transparent: true,
      opacity: 0.95,
      depthWrite: false,
    });
    const line = new THREE.LineSegments(lgeom, lmat);
    line.renderOrder = OVERLAY_RENDER_ORDER + 1;
    line.raycast = () => {};
    mesh.add(line); // child: hidden with the fill, coloured alongside it
  }
  return mesh;
}

// Sum of world-space triangle areas (scene units² — the mesh is normalized to
// a 50-unit box on load, so this is relative until maps carry georeferencing).
export function worldArea(mesh, faces) {
  const posAttr = mesh.geometry.getAttribute("position");
  const index = mesh.geometry.index;
  const vertIdx = index
    ? (f, c) => index.getX(f * 3 + c)
    : (f, c) => f * 3 + c;
  const va = new THREE.Vector3();
  const vb = new THREE.Vector3();
  const vc = new THREE.Vector3();
  const e1 = new THREE.Vector3();
  const e2 = new THREE.Vector3();
  let area = 0;
  for (const f of faces) {
    va.fromBufferAttribute(posAttr, vertIdx(f, 0)).applyMatrix4(mesh.matrixWorld);
    vb.fromBufferAttribute(posAttr, vertIdx(f, 1)).applyMatrix4(mesh.matrixWorld);
    vc.fromBufferAttribute(posAttr, vertIdx(f, 2)).applyMatrix4(mesh.matrixWorld);
    area += e1.subVectors(vb, va).cross(e2.subVectors(vc, va)).length() * 0.5;
  }
  return area;
}

// Owns the label records for one map: suggestion, painted overlays,
// localStorage persistence, and JSON export. Tiles are identified by their
// index in root traversal order, which is deterministic for a given GLB.
export class LabelManager {
  constructor({ scene, root, mapKey }) {
    this.scene = scene;
    this.root = root;
    this.mapKey = mapKey;
    this.labels = [];
    this.overlays = new Map(); // label id -> overlay mesh
    this._seq = 0;
    this._quotaWarned = false;

    root.updateMatrixWorld(true);
    this.tileMeshes = [];
    root.traverse((c) => {
      if (c.isMesh) this.tileMeshes.push(c);
    });
    this.tileIndex = new Map(this.tileMeshes.map((m, i) => [m, i]));
    this.bbox = new THREE.Box3().setFromObject(root);
  }

  storageKey() {
    return `dmt:labels:${this.mapKey}`;
  }

  // --- view filtering --------------------------------------------------------
  // "all": overlays in class colors. "untagged": labeled areas dimmed to
  // near-ink so REMAINING work pops. "confirmed"/"proposals": filter by
  // confidence. classId (isolation) overrides the mode.
  applyView(view) {
    if (view) this.currentView = view;
    for (const label of this.labels) this.applyViewToOverlay(label);
  }

  applyViewToOverlay(label) {
    const overlay = this.overlays.get(label.id);
    if (!overlay) return;
    // Default is "hidden": overlays are off until the user opts into a view,
    // so exploring the raw mesh isn't blanketed by every label/proposal.
    const v = this.currentView || { mode: "hidden", classId: null };
    const cls = LABEL_CLASSES.find((c) => c.id === label.class);
    let visible = true;
    let dim = false;
    if (v.classId) visible = label.class === v.classId;
    else if (v.mode === "hidden") visible = false;
    else if (v.mode === "untagged") dim = true;
    else if (v.mode === "confirmed") visible = label.confidence === "confirmed";
    else if (v.mode === "proposals") visible = label.confidence === "flagged";
    overlay.visible = visible;
    const color = dim ? "#191C19" : cls ? cls.color : "#ffffff";
    overlay.material.color.set(color);
    overlay.material.opacity = dim ? 0.5 : 0.42;
    const outline = overlay.children[0];
    if (outline) {
      outline.material.color.set(color);
      outline.material.opacity = dim ? 0.35 : 0.95; // outline recedes when dimmed
    }
  }

  // Area-weighted labeled fraction (scene units²). Total mesh area is
  // computed once and cached; overlapping labels can nudge past 100 — clamp.
  coverage() {
    if (this._totalArea == null) {
      let total = 0;
      for (const mesh of this.tileMeshes) {
        const index = mesh.geometry.index;
        const faceCount = index
          ? index.count / 3
          : mesh.geometry.getAttribute("position").count / 3;
        const all = new Array(faceCount);
        for (let f = 0; f < faceCount; f++) all[f] = f;
        total += worldArea(mesh, all);
      }
      this._totalArea = total || 1;
    }
    const labeled = this.labels.reduce((s, l) => s + (l.area || 0), 0);
    return Math.min(100, (labeled / this._totalArea) * 100);
  }

  get list() {
    return this.labels;
  }

  className(id) {
    const cls = LABEL_CLASSES.find((c) => c.id === id);
    return cls ? cls.name : id;
  }

  // --- auto-suggestion (geometric prior; the seed of "auto-detection") -----

  suggestFor(pending) {
    const t = pending.targetClass;
    if (t === "wall") return "building-wall";
    if (t === "roof-pitched") return "building-roof";
    if (t === "slope") return "ground";
    if (t === "floor") return "other"; // downward-facing — rare, let the human decide
    // "roof-flat" is any horizontal-up surface; height above the site floor
    // disambiguates open ground from an actual flat roof.
    const frac = this.meanHeightFraction(pending.selected);
    return frac < GROUND_HEIGHT_FRACTION ? "ground" : "building-roof";
  }

  meanHeightFraction(selectedMap) {
    const height = this.bbox.max.y - this.bbox.min.y || 1;
    const v = new THREE.Vector3();
    let sum = 0;
    let n = 0;
    outer: for (const [mesh, faces] of selectedMap) {
      const posAttr = mesh.geometry.getAttribute("position");
      const index = mesh.geometry.index;
      for (const f of faces) {
        const vi = index ? index.getX(f * 3) : f * 3;
        v.fromBufferAttribute(posAttr, vi).applyMatrix4(mesh.matrixWorld);
        sum += v.y;
        n++;
        if (n >= 500) break outer; // a sample is plenty
      }
    }
    if (!n) return 1;
    return (sum / n - this.bbox.min.y) / height;
  }

  // --- CRUD ----------------------------------------------------------------

  add({ selected, classId, confidence, suggested, targetClass, source, deferPersist }) {
    const tiles = [];
    let faceCount = 0;
    let area = 0;
    for (const [mesh, faces] of selected) {
      const t = this.tileIndex.get(mesh);
      if (t == null) continue;
      const sorted = Array.from(faces).sort((a, b) => a - b);
      faceCount += sorted.length;
      area += worldArea(mesh, sorted);
      tiles.push({ t, df: deltaEncode(sorted) });
    }
    if (!faceCount) return null;

    const label = {
      id: `L${(this._seq++).toString(36)}-${Date.now().toString(36)}`,
      class: classId,
      confidence,
      source: source || "human", // provenance matters for ML exports
      suggested: suggested || null,
      geomClass: targetClass || null,
      createdAt: new Date().toISOString(),
      faceCount,
      area: +area.toFixed(3),
      tiles,
    };
    this.labels.push(label);
    this.paint(label);
    if (!deferPersist) this.persist();
    return label;
  }

  // Drop all machine proposals (used before an auto-tag re-run). Human
  // labels — any source !== "auto" — are untouched.
  removeAuto() {
    const auto = this.labels.filter((l) => l.source === "auto");
    for (const label of auto) {
      const overlay = this.overlays.get(label.id);
      if (overlay) {
        this.scene.remove(overlay);
        overlay.geometry.dispose();
        overlay.material.dispose();
        overlay.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
        this.overlays.delete(label.id);
      }
    }
    this.labels = this.labels.filter((l) => l.source !== "auto");
    this.persist();
    return auto.length;
  }

  remove(id) {
    const overlay = this.overlays.get(id);
    if (overlay) {
      this.scene.remove(overlay);
      overlay.geometry.dispose();
      overlay.material.dispose();
      overlay.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
      this.overlays.delete(id);
    }
    this.labels = this.labels.filter((l) => l.id !== id);
    this.persist();
  }

  // Which label (if any) owns this face? Decodes only the hit tile's delta
  // list per label — cheap enough to run per click.
  findLabelAt(mesh, faceIdx) {
    const t = this.tileIndex.get(mesh);
    if (t == null) return null;
    for (const label of this.labels) {
      const tile = label.tiles.find((x) => x.t === t);
      if (!tile) continue;
      let acc = 0;
      for (const d of tile.df) {
        acc += d;
        if (acc === faceIdx) return label;
        if (acc > faceIdx) break;
      }
    }
    return null;
  }

  // Stored label -> live Map(mesh -> Set(faceIdx)) for editing.
  decodeSelection(label) {
    const map = new Map();
    for (const { t, df } of label.tiles) {
      const mesh = this.tileMeshes[t];
      if (!mesh) continue;
      const set = new Set();
      let acc = 0;
      for (const d of df) {
        acc += d;
        set.add(acc);
      }
      map.set(mesh, set);
    }
    return map;
  }

  // Replace a label's geometry (and optionally class/confidence) in place —
  // the click-to-edit flow. Repaints the overlay and persists.
  update(id, { selected, classId, confidence }) {
    const label = this.labels.find((l) => l.id === id);
    if (!label) return null;
    const tiles = [];
    let faceCount = 0;
    let area = 0;
    for (const [mesh, faces] of selected) {
      const t = this.tileIndex.get(mesh);
      if (t == null) continue;
      const sorted = Array.from(faces).sort((a, b) => a - b);
      faceCount += sorted.length;
      area += worldArea(mesh, sorted);
      tiles.push({ t, df: deltaEncode(sorted) });
    }
    if (!faceCount) return null;
    label.tiles = tiles;
    label.faceCount = faceCount;
    label.area = +area.toFixed(3);
    if (classId) label.class = classId;
    if (confidence) label.confidence = confidence;
    label.editedAt = new Date().toISOString();
    const overlay = this.overlays.get(id);
    if (overlay) {
      this.scene.remove(overlay);
      overlay.geometry.dispose();
      overlay.material.dispose();
      overlay.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
      this.overlays.delete(id);
    }
    this.paint(label);
    this.persist();
    return label;
  }

  setOverlayVisible(id, on) {
    const overlay = this.overlays.get(id);
    if (overlay) overlay.visible = on;
  }

  // Review-verb mutations: reclassify (repaints the overlay in the new class
  // color) and confidence transitions. Both persist immediately.
  setClass(id, classId) {
    const label = this.labels.find((l) => l.id === id);
    if (!label || label.class === classId) return;
    label.class = classId;
    const overlay = this.overlays.get(id);
    if (overlay) {
      this.scene.remove(overlay);
      overlay.geometry.dispose();
      overlay.material.dispose();
      overlay.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
      this.overlays.delete(id);
    }
    this.paint(label);
    this.persist();
  }

  setConfidence(id, confidence) {
    const label = this.labels.find((l) => l.id === id);
    if (!label) return;
    label.confidence = confidence;
    this.persist();
  }

  // World-space bounding box of a label, from a bounded sample of its faces
  // (an 80k-face ground label doesn't need every vertex visited to frame it).
  worldBBoxOf(label, maxSamples = 600) {
    const box = new THREE.Box3();
    const v = new THREE.Vector3();
    let total = 0;
    for (const { df } of label.tiles) total += df.length;
    const stride = Math.max(1, Math.floor(total / maxSamples));

    for (const { t, df } of label.tiles) {
      const mesh = this.tileMeshes[t];
      if (!mesh) continue;
      const posAttr = mesh.geometry.getAttribute("position");
      const index = mesh.geometry.index;
      const faces = deltaDecode(df);
      for (let k = 0; k < faces.length; k += stride) {
        const f = faces[k];
        for (let c = 0; c < 3; c++) {
          const vi = index ? index.getX(f * 3 + c) : f * 3 + c;
          box.expandByPoint(
            v.fromBufferAttribute(posAttr, vi).applyMatrix4(mesh.matrixWorld)
          );
        }
      }
    }
    return box;
  }

  // Review-mode overlay control: show only the item being reviewed.
  setOverlaysVisible(predicate) {
    for (const label of this.labels) {
      const overlay = this.overlays.get(label.id);
      if (overlay) overlay.visible = predicate(label);
    }
  }

  emphasize(id, on) {
    const overlay = this.overlays.get(id);
    if (overlay) {
      overlay.material.opacity = on ? OVERLAY_EMPHASIS_OPACITY : OVERLAY_OPACITY;
    }
  }

  clearAll() {
    for (const id of Array.from(this.overlays.keys())) {
      const overlay = this.overlays.get(id);
      this.scene.remove(overlay);
      overlay.geometry.dispose();
      overlay.material.dispose();
      overlay.children.forEach((c) => { c.geometry.dispose(); c.material.dispose(); });
    }
    this.overlays.clear();
    this.labels = [];
    this.persist();
  }

  paint(label) {
    const cls = LABEL_CLASSES.find((c) => c.id === label.class);
    const mesh = buildFacesMesh(this.tileMeshes, label.tiles, cls ? cls.color : "#ffffff");
    if (!mesh) return;
    this.scene.add(mesh);
    this.overlays.set(label.id, mesh);
    if (this.currentView) this.applyViewToOverlay(label); // honor the active filter
  }

  // --- persistence & export -------------------------------------------------

  persist() {
    try {
      localStorage.setItem(
        this.storageKey(),
        JSON.stringify({ v: STORAGE_VERSION, savedAt: new Date().toISOString(), labels: this.labels })
      );
    } catch (err) {
      console.warn("label persist failed", err);
      if (!this._quotaWarned) {
        this._quotaWarned = true;
        alert("Label storage is full — labels still work and export, but won't survive a reload.");
      }
    }
  }

  restore() {
    let raw;
    try {
      raw = localStorage.getItem(this.storageKey());
    } catch (err) {
      return 0;
    }
    if (!raw) return 0;
    try {
      const data = JSON.parse(raw);
      if (data.v !== STORAGE_VERSION || !Array.isArray(data.labels)) return 0;
      this.labels = data.labels;
      for (const label of this.labels) this.paint(label);
      return this.labels.length;
    } catch (err) {
      console.warn("label restore failed", err);
      return 0;
    }
  }

  exportDownload() {
    const payload = {
      format: `drone-mesh-tag/labels@${STORAGE_VERSION}`,
      exportedAt: new Date().toISOString(),
      mapKey: this.mapKey,
      faceEncoding: "delta", // per tile: sorted face indices, delta-encoded
      taxonomy: LABEL_CLASSES.map(({ id, name, osm }) => ({ id, name, osm })),
      confidenceLevels: CONFIDENCE_LEVELS.map((c) => c.id),
      labelCount: this.labels.length,
      labels: this.labels,
    };
    const blob = new Blob([JSON.stringify(payload, null, 1)], { type: "application/json" });
    const a = document.createElement("a");
    a.href = URL.createObjectURL(blob);
    a.download = `mesh-labels-${new Date().toISOString().slice(0, 10)}.json`;
    a.click();
    URL.revokeObjectURL(a.href);
  }
}
