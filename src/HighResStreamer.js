import * as THREE from "three";
import { cachedArrayBuffer } from "./modelCache.js";

// The high-res model is one Draco-compressed mesh with 130 primitives, each
// with its own ~2048x2048 webp texture (EXT_texture_webp). If GLTFLoader parses
// it normally it decodes ALL 130 webps up front - a ~2.5 GB memory spike that
// crashes tablets/phones, independent of how many textures we later upload.
//
// This streamer avoids that entirely:
//   1. Fetch the GLB once (the browser disk-caches it).
//   2. Rewrite the glTF JSON to remove every texture/image reference, so
//      GLTFLoader decodes ZERO images and only inflates the (small) geometry.
//   3. Keep each tile's compressed webp bytes; decode + upload a tile's texture
//      only while the camera is near it, and dispose it (texture + bitmap) when
//      it moves away.
// Net effect: at most `maxHighResTiles` textures are ever decoded or resident.
const WEBP_EXT = "EXT_texture_webp";
const GLB_MAGIC = 0x46546c67;
const CHUNK_JSON = 0x4e4f534a;
const CHUNK_BIN = 0x004e4942;

// Tiered gaze-bubble streaming: tiles inside a small radius of the gaze
// point (view ray ∩ ground plane) or the camera get NATIVE resolution, a
// wider ring gets RING resolution, everything else stays on the resident
// base textures. Radii scale with the map's tile pitch; resident tiles use
// enlarged radii (hysteresis) so ring boundaries don't flap while flying.
// Native uploads are therefore few and land exactly where the user looks —
// high quality AND smooth navigation, not one or the other.
// Margins are measured from the gaze point / camera to each tile's SAMPLED
// GEOMETRY (a few dozen face centroids per tile). ODM "tiles" are
// texture-atlas charts whose faces can be scattered across the whole map,
// so both center-distance and bounding-sphere metrics degenerate (every
// bounding sphere covers everything → all scores tie → the same tiles stay
// resident forever). Sampled centroids measure where the tile actually IS.
const SAMPLES_PER_TILE = 24;
const NATIVE_MARGIN_PITCH = 0.9; // native tier within this distance of tile geometry
const RING_MARGIN_PITCH = 2.8; // ring tier margin, in tile pitches
const HYSTERESIS = 1.35; // resident tiles cling to their tier this much longer

// Face-level spatial index (atlas-page maps): every face centroid is binned
// into an XZ grid, so each cell knows exactly which PAGES have geometry in
// it. "Deferred until needed" then works even though pages themselves are
// scattered: pages with faces near the camera/gaze promote; everything else
// stays at base until approached. No sampling gaps — every face is indexed.
const INDEX_GRID = 28; // cells per axis over the map footprint
// TRUE 3D distance thresholds (scene units, altitude included), SINGLE tier:
// nothing speculative ever loads. Pages promote to native only inside the
// load radius; already-resident pages are merely KEPT (zero work) until the
// unload boundary; everything else is base. Flying high = far from
// everything = nothing loads. Trade-off accepted by design: crossing the
// boundary pops 512 → native with no pre-staged middle step.
// Tuned for STREET-LEVEL proximity (1-3 units from a wall). Deliberately
// tight: at any altitude that frames a whole district, nothing qualifies —
// absolute distances read as "near" far too easily from elevated views.
// (The principled future version is screen-space error, as in 3D Tiles.)
// Load/reveal radii are sized for NORMAL viewing distance (you inspect a
// building from ~10-20 units, not pressed against it), not just point-blank.
// Too tight and what's right in front of you stays base. At true altitude
// (whole-map overview) distances exceed these, so nothing loads → clean.
const NATIVE_WORLD_DIST = 18; // load radius
const ATLAS_UNLOAD_DIST = 30; // keep-resident boundary (retention)

// Display is gated FINER than loading: each page's geometry is split at load
// into locale clusters (zone-grid buckets of faces). A resident page only
// REVEALS clusters that are near the camera AND inside the view frustum —
// its far-away sibling fragments keep showing base, so enhancement never
// appears in scattered pockets across the map.
const ZONE_GRID = 12; // cluster zones per axis over the map footprint
const CLUSTER_ON_DIST = 18; // reveal radius for enhanced clusters (matches load)

// Motion gate (scene units / second). Above HI the streamer idles; it
// resumes below LO. The gap is hysteresis so ordinary WASD nudging doesn't
// toggle it every frame.
const MOTION_HI = 3.5;
const MOTION_LO = 1.2;

export class HighResStreamer {
  constructor({ scene, camera, renderer, gltfLoader, nativeSize, ringSize, nativeCap, totalCap, keepDist, maxAnisotropy }) {
    this.scene = scene;
    this.camera = camera;
    this.renderer = renderer; // for the GPU visible-page pick pass
    this.gltfLoader = gltfLoader;
    this.nativeSize = nativeSize; // texture size inside the gaze bubble
    this.ringSize = ringSize; // texture size in the surrounding ring
    this.nativeCap = nativeCap; // max tiles at native size
    this.totalCap = totalCap; // max resident high-res tiles overall
    this.tilePitch = 5; // measured in load(); fallback for injected tiles

    // exposed for the ?viz load-zone rings; unloadDist widens on validated
    // hardware (retention is the cheap luxury — textures already paid for).
    // rangeScale is a LIVE debug multiplier over load/reveal radii ([ and ]
    // keys in ?debug) so the right feel can be dialled in-app, not guessed.
    this.rangeScale = 1;
    this.unloadDist = keepDist || ATLAS_UNLOAD_DIST;

    // Whether tiles are spatially localized. ODM atlas pages are usually NOT
    // — each "tile" scatters faces across the entire map (measured: every
    // tile bbox spans the whole site), which makes any spatial tile
    // selection meaningless. In that case the only correct strategy is
    // uniform residency at a budgeted size; the gaze bubble applies only to
    // genuinely spatial tilings (e.g. future re-tiled/3D-Tiles pipelines).
    this.spatialTiling = true; // measured in load(); tests may override

    this.tiles = [];
    this.group = null;
    this.active = false;

    this.decoding = 0;
    this.maxConcurrentDecodes = 3;
    this.decodeCount = 0; // diagnostic: total tiles ever decoded

    // Decoded images wait here and upload at most ONE per rendered frame
    // (drainUploads, called from the main loop). Uploading several 2048²
    // textures + mipmap generation in a single frame is what caused visible
    // hitches during the initial sharpen-up.
    this.uploadQueue = [];

    // Motion gating: during fast fly-through the streamer idles completely —
    // no decode, no upload — so navigation is never interrupted by texture
    // work. Detail streams in once the camera settles. Hysteresis (HI/LO)
    // stops the gate flickering at walking pace. camSpeed is fed per-frame.
    this.camSpeed = 0;
    this.motionHold = false;
    this.maxAnisotropy = maxAnisotropy || 1;

    // Shared 1×1 placeholder so every page material is compiled WITH a map
    // slot from the start. Swapping in the real texture then never triggers a
    // shader recompile — those first-time null→map recompiles were a second,
    // subtler source of fly-through hitching (one per page, ever).
    this.placeholderTex = new THREE.DataTexture(
      new Uint8Array([200, 200, 200, 255]),
      1,
      1
    );
    this.placeholderTex.needsUpdate = true;

    // Review-mode overrides. focusTiles/prefetchTiles (arrays of tile indices)
    // replace camera proximity as the "wanted" strategy: focus = the item
    // under review, prefetch = the next item (decoded early so advancing is
    // instant, but kept hidden by scope). scope (Set of tile indices) limits
    // which tiles render at all — null means everything, explore behavior.
    this.focusTiles = null;
    this.prefetchTiles = null;
    this.scope = null;
    // Review orbit: enhance what's framed on screen exactly like explore
    // (pick-driven), but reveal promoted clusters by frustum alone — the
    // orbit distance to a framed item often exceeds explore's reveal radius,
    // and off-screen fragments stay hidden by the frustum test regardless.
    this.reviewOrbit = false;
  }

  // Fetch + strip + load geometry, overlay it on the low-res base. Resolves once
  // the (untextured) high-res geometry is in the scene; textures stream in after.
  async load(url, lowResObject) {
    const buffer = await cachedArrayBuffer(url); // IndexedDB-cached (see modelCache)

    const { json, bin } = this.parseGLB(buffer);
    const imageByMaterial = this.extractTileImages(json, bin);
    const strippedGLB = this.rebuildGLB(this.stripTextures(json), bin);

    const gltf = await this.parseGLTF(strippedGLB);
    const obj = gltf.scene;

    // Match the transform the low-res base received so the tiles overlay it.
    const group = new THREE.Group();
    group.rotation.order = "YXZ";
    group.rotation.y = Math.PI;
    group.rotation.x = -Math.PI / 2;
    const box = new THREE.Box3().setFromObject(obj);
    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());
    const scale = 50 / Math.max(size.x, size.y, size.z);
    group.scale.multiplyScalar(scale);
    group.position.sub(center.multiplyScalar(scale));
    group.position.y = 0;

    const meshes = [];
    obj.traverse((c) => {
      if (c.isMesh) meshes.push(c);
    });
    meshes.forEach((m) => {
      m.castShadow = false;
      m.receiveShadow = false;
      m.frustumCulled = true;
      m.visible = false; // hidden until its texture is decoded
      group.add(m);
    });
    this.scene.add(group);
    group.updateWorldMatrix(true, true);
    this.group = group;

    this.lowRoot = lowResObject; // rendered (id-coloured) for the pick pass
    const lowTiles = [];
    if (lowResObject) {
      lowResObject.traverse((c) => {
        if (c.isMesh) lowTiles.push(c);
      });
    }

    // World-space face centroids sampled evenly across a tile's index — the
    // tile's true spatial footprint, robust to scattered atlas charts.
    const sampleFaceCentroids = (mesh, count) => {
      const pos = mesh.geometry.getAttribute("position");
      const index = mesh.geometry.index;
      const faceCount = index ? index.count / 3 : pos.count / 3;
      const stride = Math.max(1, Math.floor(faceCount / count));
      const pts = [];
      const v = new THREE.Vector3();
      for (let f = 0; f < faceCount && pts.length < count; f += stride) {
        const p = new THREE.Vector3();
        for (let c = 0; c < 3; c++) {
          const vi = index ? index.getX(f * 3 + c) : f * 3 + c;
          p.add(v.fromBufferAttribute(pos, vi));
        }
        pts.push(p.multiplyScalar(1 / 3).applyMatrix4(mesh.matrixWorld));
      }
      return pts;
    };

    const localCenter = new THREE.Vector3();
    this.tiles = meshes.map((mesh, i) => {
      const matIndex = this.materialIndexOf(mesh, i);
      const img = imageByMaterial[matIndex];
      if (!mesh.geometry.boundingBox) mesh.geometry.computeBoundingBox();
      mesh.geometry.boundingBox.getCenter(localCenter);
      return {
        index: i,
        mesh,
        low: lowTiles[i] || null,
        center: localCenter.clone().applyMatrix4(mesh.matrixWorld),
        samples: sampleFaceCentroids(mesh, SAMPLES_PER_TILE),
        bytes: img ? img.bytes : null,
        mime: img ? img.mime : null,
        state: "low", // low | loading | high (display state)
        size: 0, // resident texture size (0 = base only)
        targetSize: 0, // what computeTargets wants resident
        decoding: false, // a decode for this tile is in flight
        texture: null,
        wanted: false,
      };
    });

    // Median nearest-neighbour spacing of tile centers — the gaze-bubble
    // radii scale with this, so behavior is consistent across map tilings.
    const sample = Math.min(this.tiles.length, 30);
    const dists = [];
    for (let i = 0; i < sample; i++) {
      let best = Infinity;
      for (const o of this.tiles) {
        if (o !== this.tiles[i]) {
          best = Math.min(best, o.center.distanceToSquared(this.tiles[i].center));
        }
      }
      if (best < Infinity) dists.push(Math.sqrt(best));
    }
    dists.sort((a, b) => a - b);
    if (dists.length) this.tilePitch = dists[Math.floor(dists.length / 2)];

    // Spatial-tiling detection: compare median tile extent to the map extent.
    // Atlas-page "tiles" span the whole map → face-level spatial index mode.
    const mapBox = new THREE.Box3();
    const tileDiags = [];
    const tb = new THREE.Box3();
    for (const t of this.tiles) {
      tb.setFromObject(t.mesh);
      mapBox.union(tb);
      tileDiags.push(tb.min.distanceTo(tb.max));
    }
    tileDiags.sort((a, b) => a - b);
    const medianDiag = tileDiags[Math.floor(tileDiags.length / 2)] || 0;
    const mapDiag = mapBox.min.distanceTo(mapBox.max) || 1;
    this.mapBox = mapBox;
    this.spatialTiling = medianDiag < mapDiag * 0.5;
    console.log(
      `[streamer] tile extent ${(medianDiag / mapDiag * 100).toFixed(0)}% of map → ` +
        (this.spatialTiling
          ? "spatial tiling: gaze-bubble streaming"
          : "atlas pages: face-level spatial index (deferred-until-needed)")
    );
    if (!this.spatialTiling) {
      this.buildSpatialIndex();
      this.buildClusters();
    }

    this.active = true;
    this.update();
    return this.tiles.length;
  }

  // Bin EVERY face centroid of every page into an XZ grid. One-time cost at
  // load (~500k faces ≈ tens of ms); afterwards "which pages have geometry
  // near point P" is an exact O(cells) query instead of a sampling guess.
  buildSpatialIndex() {
    const t0 = performance.now();
    const n = INDEX_GRID;
    const minX = this.mapBox.min.x;
    const minZ = this.mapBox.min.z;
    const cellW = (this.mapBox.max.x - minX) / n || 1;
    const cellD = (this.mapBox.max.z - minZ) / n || 1;
    const cells = new Array(n * n).fill(null);
    const ySum = new Float64Array(n * n);
    const yCount = new Uint32Array(n * n);
    const v = new THREE.Vector3();

    for (const tile of this.tiles) {
      const geom = tile.mesh.geometry;
      const pos = geom.getAttribute("position");
      const index = geom.index;
      const faceCount = index ? index.count / 3 : pos.count / 3;
      const mw = tile.mesh.matrixWorld;
      for (let f = 0; f < faceCount; f++) {
        // one corner per face is plenty at this cell size
        const vi = index ? index.getX(f * 3) : f * 3;
        v.fromBufferAttribute(pos, vi).applyMatrix4(mw);
        const cx = Math.min(n - 1, Math.max(0, Math.floor((v.x - minX) / cellW)));
        const cz = Math.min(n - 1, Math.max(0, Math.floor((v.z - minZ) / cellD)));
        const key = cz * n + cx;
        (cells[key] || (cells[key] = new Set())).add(tile.index);
        ySum[key] += v.y;
        yCount[key]++;
      }
    }

    this.cellPages = cells;
    this.cellY = new Float32Array(n * n);
    for (let k = 0; k < n * n; k++) {
      this.cellY[k] = yCount[k] ? ySum[k] / yCount[k] : 0;
    }
    this.grid = { n, minX, minZ, cellW, cellD };
    // stats: how many pages does a typical neighbourhood actually need?
    const mid = cells[Math.floor(cells.length / 2)];
    console.log(
      `[streamer] spatial index built in ${(performance.now() - t0).toFixed(0)}ms · ` +
        `${n}x${n} cells · centre cell touches ${mid ? mid.size : 0} pages`
    );
  }

  // Split each page's index into locale clusters (contiguous ranges grouped
  // by zone), so display can be gated per cluster while the texture stays
  // one per page. The page keeps ONE geometry + material; groups flip
  // between the real material (0) and a shared invisible material (1).
  // The base (low) mesh underneath stays whole and always visible;
  // polygonOffset lets revealed clusters win the depth fight cleanly.
  buildClusters() {
    const Z = ZONE_GRID;
    const minX = this.mapBox.min.x;
    const minZ = this.mapBox.min.z;
    const zw = (this.mapBox.max.x - minX) / Z || 1;
    const zd = (this.mapBox.max.z - minZ) / Z || 1;
    const v = new THREE.Vector3();
    this.hiddenMat = this.hiddenMat || new THREE.MeshBasicMaterial({ visible: false });

    for (const t of this.tiles) {
      const geom = t.mesh.geometry;
      const index = geom.index;
      if (!index) continue; // non-indexed: whole-page fallback
      const pos = geom.getAttribute("position");
      const faceCount = index.count / 3;
      const mw = t.mesh.matrixWorld;

      const buckets = new Map(); // zoneKey -> {faces, sx, sy, sz}
      for (let f = 0; f < faceCount; f++) {
        const vi = index.getX(f * 3);
        v.fromBufferAttribute(pos, vi).applyMatrix4(mw);
        const zx = Math.min(Z - 1, Math.max(0, Math.floor((v.x - minX) / zw)));
        const zz = Math.min(Z - 1, Math.max(0, Math.floor((v.z - minZ) / zd)));
        const key = zz * Z + zx;
        let b = buckets.get(key);
        if (!b) {
          b = { faces: [], sx: 0, sy: 0, sz: 0 };
          buckets.set(key, b);
        }
        b.faces.push(f);
        b.sx += v.x;
        b.sy += v.y;
        b.sz += v.z;
      }

      // reorder the index so every cluster is one contiguous group
      const src = index.array;
      const dst = new src.constructor(src.length);
      const clusters = [];
      let o = 0;
      for (const b of buckets.values()) {
        const start = o;
        for (const f of b.faces) {
          dst[o++] = src[f * 3];
          dst[o++] = src[f * 3 + 1];
          dst[o++] = src[f * 3 + 2];
        }
        clusters.push({
          start,
          count: o - start,
          centroid: new THREE.Vector3(
            b.sx / b.faces.length,
            b.sy / b.faces.length,
            b.sz / b.faces.length
          ),
          on: false,
        });
      }
      geom.setIndex(new THREE.BufferAttribute(dst, 1));
      geom.clearGroups();
      for (const c of clusters) geom.addGroup(c.start, c.count, 1); // start hidden

      const pageMat = t.mesh.material;
      pageMat.polygonOffset = true;
      pageMat.polygonOffsetFactor = -1;
      pageMat.polygonOffsetUnits = -1;
      // Compile the program WITH a map slot now (placeholder) so the real
      // texture swap later never recompiles the shader mid-fly-through.
      if (!pageMat.map) {
        pageMat.map = this.placeholderTex;
        pageMat.needsUpdate = true;
      }
      t.mesh.material = [pageMat, this.hiddenMat];
      t.pageMat = pageMat;
      t.clusters = clusters;
    }
  }

  _updateFrustum() {
    this._frustum = this._frustum || new THREE.Frustum();
    this._projView = this._projView || new THREE.Matrix4();
    this.camera.updateMatrixWorld();
    this._projView.multiplyMatrices(
      this.camera.projectionMatrix,
      this.camera.matrixWorldInverse
    );
    this._frustum.setFromProjectionMatrix(this._projView);
    return this._frustum;
  }

  // Reveal enhanced clusters only when near the camera AND in the frustum
  // (review focus reveals the whole item regardless of orbit distance).
  updateClusterVisibility() {
    if (this.spatialTiling) return;
    this._updateFrustum();
    const cam = this.camera.position;
    const focusMode = !!this.focusTiles;

    for (const t of this.tiles) {
      if (!t.clusters) continue;
      const promoted = t.state === "high";
      const groups = t.mesh.geometry.groups;
      for (let ci = 0; ci < t.clusters.length; ci++) {
        const c = t.clusters[ci];
        let on = false;
        if (promoted) {
          if (focusMode) {
            on = true;
          } else if (this.reviewOrbit) {
            // frustum-only: distance-independent so a framed item reveals at
            // any orbit range; off-screen fragments stay hidden.
            on = this._frustum.containsPoint(c.centroid);
          } else {
            const base = CLUSTER_ON_DIST * this.rangeScale;
            const limit = c.on ? base * 1.25 : base;
            const d = cam.distanceTo(c.centroid);
            on = d <= limit && (d < 3 || this._frustum.containsPoint(c.centroid));
          }
        }
        c.on = on;
        groups[ci].materialIndex = on ? 0 : 1;
      }
    }
  }

  get loadRadius() {
    return NATIVE_WORLD_DIST * this.rangeScale;
  }

  get revealRadius() {
    return CLUSTER_ON_DIST * this.rangeScale;
  }

  cellOf(p) {
    const g = this.grid;
    return {
      cx: Math.min(g.n - 1, Math.max(0, Math.floor((p.x - g.minX) / g.cellW))),
      cz: Math.min(g.n - 1, Math.max(0, Math.floor((p.z - g.minZ) / g.cellD))),
    };
  }

  // Where is the user looking? (view ray ∩ ground plane, clamped)
  computeFocus() {
    const cam = this.camera.position;
    this._dir = this._dir || new THREE.Vector3();
    this._focus = this._focus || new THREE.Vector3();
    this.camera.getWorldDirection(this._dir);
    const LOOKAHEAD_MAX = 160;
    let ahead = this._dir.y < -0.02 ? cam.y / -this._dir.y : LOOKAHEAD_MAX;
    ahead = Math.min(Math.max(ahead, 0), LOOKAHEAD_MAX);
    return this._focus.copy(this._dir).multiplyScalar(ahead).add(cam);
  }

  // GPU pick pass: render the low-res tiles into a tiny target, each tile
  // flat-coloured by its index, and read back which tiles own the on-screen
  // pixels. This is exactly "the triangles in front of me" — occlusion-
  // correct, no spatial heuristic. Returns Map(tileIndex → pixel count) or
  // null if picking isn't available.
  pickVisibleTiles() {
    const r = this.renderer;
    if (!r || !this.lowRoot || !this.tiles.length) return null;
    try {
      if (!this.pickRT) {
        this.pickRT = new THREE.WebGLRenderTarget(160, 100, {
          depthBuffer: true,
          colorSpace: THREE.NoColorSpace,
        });
        this._pickBuf = new Uint8Array(160 * 100 * 4);
        this._pickMats = [];
      }
      const swapped = [];
      for (const t of this.tiles) {
        if (!t.low) continue;
        let m = this._pickMats[t.index];
        if (!m) {
          m = new THREE.MeshBasicMaterial();
          // id in the red channel, written linearly so readback is exact
          m.color.setRGB((t.index + 1) / 255, 0, 0, THREE.LinearSRGBColorSpace);
          this._pickMats[t.index] = m;
        }
        t._pm = t.low.material;
        t._pv = t.low.visible;
        t.low.material = m;
        t.low.visible = true;
        swapped.push(t);
      }
      const prev = r.getRenderTarget();
      r.setRenderTarget(this.pickRT);
      r.setClearColor(0x000000, 1);
      r.clear();
      r.render(this.lowRoot, this.camera);
      r.readRenderTargetPixels(this.pickRT, 0, 0, 160, 100, this._pickBuf);
      r.setRenderTarget(prev);
      for (const t of swapped) {
        t.low.material = t._pm;
        t.low.visible = t._pv;
      }
      const counts = new Map();
      const buf = this._pickBuf;
      for (let i = 0; i < buf.length; i += 4) {
        const id = buf[i] - 1;
        if (id >= 0) counts.set(id, (counts.get(id) || 0) + 1);
      }
      return counts;
    } catch (e) {
      console.warn("pick pass failed, falling back to distance", e);
      return null;
    }
  }

  // Atlas load: sharpen the tiles the pick pass says are actually on screen,
  // most-covered first, up to budget. Falls back to nearest-distance if the
  // pick pass is unavailable.
  computeTargetsFromIndex() {
    // Skip the pick (a GPU readback stall) during fast fly-through — we're not
    // uploading anyway; targets refresh the moment the camera settles. Review
    // orbit is exempt: it's not a fly-through, and the inter-item tween must
    // not suppress the pick or items arrive stuck at low-res.
    if (this.motionHold && !this.reviewOrbit) return;
    const counts = this.pickVisibleTiles();
    if (!counts) return this.computeTargetsByDistance();

    for (const t of this.tiles) t.targetSize = 0;
    let nativeLeft = this.nativeCap;
    let totalLeft = this.totalCap;
    const ranked = [...counts.entries()].sort((a, b) => b[1] - a[1]);
    const visible = new Set();
    for (const [id, px] of ranked) {
      const t = this.tiles[id];
      if (!t || !t.bytes) continue;
      visible.add(id);
      if (totalLeft <= 0) continue;
      t._score = -px;
      t.targetSize = nativeLeft > 0 ? this.nativeSize : this.ringSize;
      if (nativeLeft > 0) nativeLeft--;
      totalLeft--;
    }
    // Retention: keep a resident tile that briefly left the frame so a small
    // turn doesn't dump it (until budget is needed by on-screen tiles).
    if (totalLeft > 0) {
      for (const t of this.tiles) {
        if (totalLeft <= 0) break;
        if (t.size > 0 && t.targetSize === 0 && this._recentVisible &&
            this._recentVisible.has(t.index)) {
          t.targetSize = t.size;
          totalLeft--;
        }
      }
    }
    this._recentVisible = visible;
  }

  // Fallback (no GPU pick): nearest in-view cell distance via the face index.
  computeTargetsByDistance() {
    const cam = this.camera.position;
    const g = this.grid;
    const frustum = this._updateFrustum();
    this._cellPt = this._cellPt || new THREE.Vector3();
    const loadDist = NATIVE_WORLD_DIST * this.rangeScale;

    // Rank pages by their NEAREST in-view cell distance and load closest
    // first. The page owning the surface right in front of you has the
    // smallest distance, so it always wins the budget — summed "presence"
    // was wrong (a page with many mid-distance fragments beat the near one).
    // dAll (nearest cell any direction) governs retention only.
    const dVisMap = new Map(); // page -> nearest in-view cell distance
    const dAllMap = new Map(); // page -> nearest cell distance (retention)
    for (let cz = 0; cz < g.n; cz++) {
      for (let cx = 0; cx < g.n; cx++) {
        const key = cz * g.n + cx;
        const set = this.cellPages[key];
        if (!set) continue;
        const wx = g.minX + (cx + 0.5) * g.cellW;
        const wz = g.minZ + (cz + 0.5) * g.cellD;
        const wy = this.cellY ? this.cellY[key] : 0;
        const d = Math.hypot(cam.x - wx, cam.y - wy, cam.z - wz);
        if (d > this.unloadDist) continue;
        const inView =
          d <= loadDist && (d < 4 || frustum.containsPoint(this._cellPt.set(wx, wy, wz)));
        for (const page of set) {
          const prev = dAllMap.get(page);
          if (prev === undefined || d < prev) dAllMap.set(page, d);
          if (inView) {
            const pv = dVisMap.get(page);
            if (pv === undefined || d < pv) dVisMap.set(page, d);
          }
        }
      }
    }

    for (const t of this.tiles) t.targetSize = 0;
    let nativeLeft = this.nativeCap;
    let totalLeft = this.totalCap;

    // nearest in-view pages first, up to budget
    const ranked = [...dVisMap.entries()].sort((a, b) => a[1] - b[1]);
    for (const [page, dVis] of ranked) {
      const t = this.tiles[page];
      if (!t || !t.bytes || totalLeft <= 0) continue;
      t._score = dVis;
      t.targetSize = nativeLeft > 0 ? this.nativeSize : this.ringSize;
      if (nativeLeft > 0) nativeLeft--;
      totalLeft--;
    }

    // Retention: keep already-resident pages that are still within unloadDist
    // even if they left the frame, so glancing away doesn't dump them.
    if (totalLeft > 0) {
      for (const t of this.tiles) {
        if (totalLeft <= 0) break;
        if (t.size > 0 && t.targetSize === 0) {
          const dAll = dAllMap.get(t.index);
          if (dAll !== undefined && dAll <= this.unloadDist) {
            t.targetSize = t.size;
            totalLeft--;
          }
        }
      }
    }
  }

  // Decide every tile's target resolution. Gaze-bubble by default;
  // setFocus() (review mode) pins native quality to an explicit tile list.
  computeTargets() {
    if (this.focusTiles) {
      for (const t of this.tiles) t.targetSize = 0;
      let budget = this.totalCap;
      const take = (indices) => {
        if (!indices) return;
        for (const i of indices) {
          if (budget <= 0) return;
          const t = this.tiles[i];
          if (t && t.bytes && t.targetSize === 0) {
            t.targetSize = this.nativeSize; // the item under review deserves max
            budget--;
          }
        }
      };
      take(this.focusTiles); // current item first — prefetch fills leftover budget
      take(this.prefetchTiles);
      return;
    }

    // Atlas-page tilings: defer-until-needed via the face-level index.
    // (Fallback to uniform residency only if the index is missing.)
    if (!this.spatialTiling) {
      if (this.cellPages) {
        this.computeTargetsFromIndex();
      } else {
        for (const t of this.tiles) {
          t.targetSize = t.bytes ? Math.max(t.size, this.ringSize) : 0;
        }
      }
      return;
    }

    // Gaze focus = view ray ∩ ground plane (clamped). Pure camera distance
    // fails oblique aerial views: the nearest tiles sit below/behind the
    // camera off-screen while everything actually in frame stays base-res.
    const cam = this.camera.position;
    this._dir = this._dir || new THREE.Vector3();
    this._focus = this._focus || new THREE.Vector3();
    this.camera.getWorldDirection(this._dir);
    const LOOKAHEAD_MAX = 160; // scene units — near-horizon gazes don't chase infinity
    let ahead = this._dir.y < -0.02 ? cam.y / -this._dir.y : LOOKAHEAD_MAX;
    ahead = Math.min(Math.max(ahead, 0), LOOKAHEAD_MAX);
    this._focus.copy(this._dir).multiplyScalar(ahead).add(cam);

    for (const tile of this.tiles) {
      const pts = tile.samples && tile.samples.length ? tile.samples : [tile.center];
      let best = Infinity;
      for (const p of pts) {
        const d = Math.min(p.distanceTo(cam), p.distanceTo(this._focus));
        if (d < best) best = d;
      }
      tile._score = best; // distance to the tile's nearest sampled geometry
    }

    const r1 = this.tilePitch * NATIVE_MARGIN_PITCH;
    const r2 = this.tilePitch * RING_MARGIN_PITCH;
    const sorted = this.tiles.slice().sort((a, b) => a._score - b._score);
    let nativeLeft = this.nativeCap;
    let totalLeft = this.totalCap;

    for (const t of sorted) {
      t.targetSize = 0;
      if (!t.bytes || totalLeft <= 0) continue;
      const m = t.size > 0 ? HYSTERESIS : 1; // resident tiles cling to their tier
      if (nativeLeft > 0 && t._score <= r1 * m) {
        t.targetSize = this.nativeSize;
        nativeLeft--;
        totalLeft--;
      } else if (t._score <= r2 * m) {
        t.targetSize = this.ringSize;
        totalLeft--;
      }
    }
  }

  // Per-frame camera speed (units/sec) from the main loop drives the gate.
  setMotion(speed) {
    this.camSpeed = speed;
    if (this.motionHold) {
      if (speed < MOTION_LO) this.motionHold = false;
    } else if (speed > MOTION_HI) {
      this.motionHold = true;
    }
  }

  update() {
    if (!this.active || !this.tiles.length) return;
    this.computeTargets();

    // Targets + demotion + reveal always run (cheap, keep memory bounded and
    // the view correct). Only the EXPENSIVE work — decode + upload — is gated
    // on motion, so a fly-through never pays texture cost mid-flight. The gate
    // is IGNORED in review (focus or orbit): review is not a fly-through and
    // the inter-item camera tween must not suppress its streaming.
    if (!this.motionHold || this.focusTiles || this.reviewOrbit) {
      // Upgrades wanted, most-visible first — the 3-wide decode queue fills
      // with what the user is looking at. Resident tiles above their target
      // (native drifting into the ring) are left alone: no downgrade churn;
      // they demote fully when they leave the ring.
      const wantUp = this.tiles.filter(
        (t) => t.bytes && !t.decoding && t.targetSize > t.size
      );
      wantUp.sort((a, b) => (a._score || 0) - (b._score || 0));
      for (const t of wantUp) this.promote(t);
    }

    for (const t of this.tiles) {
      t.wanted = t.targetSize > 0;
      if (t.targetSize === 0 && t.state === "high") this.demote(t);
    }
    this.applyVisibility();
    this.updateClusterVisibility();
  }

  // Wanted-strategy override. Pass null to return to camera proximity.
  setFocus(focusIndices, prefetchIndices = null) {
    this.focusTiles = focusIndices ? Array.from(focusIndices) : null;
    this.prefetchTiles = prefetchIndices ? Array.from(prefetchIndices) : null;
    this.update();
  }

  // Review orbit streaming: pick-driven targeting (same as explore) with
  // frustum-only cluster reveal so the framed item and its surroundings all
  // sharpen regardless of orbit distance.
  setReviewOrbit(on) {
    this.reviewOrbit = !!on;
    if (on) {
      this.focusTiles = null;
      this.prefetchTiles = null;
    }
    this.update();
  }

  // Rendering scope. Pass a Set of tile indices to show only those tiles
  // (low- or high-res, whichever is resident); null shows everything.
  setScope(scopeIndices) {
    this.scope = scopeIndices ? new Set(scopeIndices) : null;
    this.applyVisibility();
  }

  applyVisibility() {
    for (const t of this.tiles) this.applyTileVisibility(t);
  }

  // Single source of truth for the low/high pair. Two regimes:
  // - clustered (atlas defer mode): base mesh ALWAYS visible; the high mesh
  //   is a selectively-revealed overlay (per-cluster material toggling with
  //   polygonOffset winning the depth fight where revealed).
  // - pair-swap (spatial gaze mode + review focus): classic low/high swap.
  applyTileVisibility(t) {
    if (t.clusters && !this.focusTiles) {
      if (t.low) t.low.visible = true;
      t.mesh.visible = t.state === "high";
      return;
    }
    const inScope = !this.scope || this.scope.has(t.index);
    const showHigh = inScope && t.state === "high";
    t.mesh.visible = showHigh;
    if (t.low) t.low.visible = inScope && !showHigh;
  }

  promote(t) {
    if (this.decoding >= this.maxConcurrentDecodes) return; // retry next tick
    const size = t.targetSize;
    t.decoding = true;
    // Base→resident shows "loading" (low tile stays visible); an in-place
    // UPGRADE keeps state "high" so the current texture never flickers out.
    if (t.state === "low") t.state = "loading";
    this.decoding++;
    this.decodeToImage(t.bytes, t.mime, size)
      .then((image) => {
        this.decoding--;
        this.uploadQueue.push({ t, image, size });
      })
      .catch((err) => {
        this.decoding--;
        t.decoding = false;
        if (t.state === "loading") t.state = "low";
        console.warn("high-res tile decode failed", err);
      });
  }

  // Called once per rendered frame from the main loop: upload at most one
  // decoded texture per frame so sharpening never stalls the camera. Skipped
  // entirely while the camera is moving fast (motion gate) — texture uploads
  // are the single most expensive main-thread op and must never land mid-fly.
  drainUploads() {
    if (this.motionHold && !this.focusTiles && !this.reviewOrbit) return;
    while (this.uploadQueue.length) {
      const { t, image, size } = this.uploadQueue.shift();
      t.decoding = false;
      if (t.targetSize === 0) {
        // demoted while decoding/queued
        if (t.state === "loading") t.state = "low";
        this.closeImage(image);
        continue; // didn't upload anything — keep looking
      }
      if (t.texture) {
        // in-place upgrade: free the old texture + its backing image
        const old = t.texture.image;
        t.texture.dispose();
        this.closeImage(old);
      }
      const tex = new THREE.Texture(image);
      tex.colorSpace = THREE.SRGBColorSpace;
      tex.flipY = false; // glTF UV convention
      tex.minFilter = THREE.LinearMipmapLinearFilter;
      tex.magFilter = THREE.LinearFilter;
      tex.generateMipmaps = true;
      tex.anisotropy = this.maxAnisotropy || 1;
      tex.needsUpdate = true;
      // After clustering, material is an ARRAY [pageMat, hidden] — assign to
      // the actual page material, never the array (a plain `.map =` on the
      // array is a silent no-op that renders clusters untextured). The
      // material already has the placeholder map, so swapping in the real
      // texture does NOT set material.needsUpdate → no shader recompile hitch.
      const mat = t.pageMat || t.mesh.material;
      const hadMap = !!mat.map;
      mat.map = tex;
      if (!hadMap) mat.needsUpdate = true; // first map ever → one recompile
      t.texture = tex;
      t.size = size;
      t.state = "high";
      this.applyTileVisibility(t);
      this.updateClusterVisibility(); // reveal immediately, not next tick
      // spike-forensics breadcrumbs (read by the ?debug long-frame logger)
      this.lastUploadTile = t.index;
      this.lastUploadSize = size;
      this.lastUploadAt = performance.now();
      return; // one real upload per frame
    }
  }

  closeImage(image) {
    if (image && typeof image.close === "function") {
      try {
        image.close();
      } catch (e) {
        /* ignore */
      }
    }
  }

  demote(t) {
    if (t.texture) {
      const img = t.texture.image;
      t.texture.dispose();
      this.closeImage(img);
      t.texture = null;
    }
    const mat = t.pageMat || t.mesh.material;
    if (mat) mat.map = null;
    t.state = "low";
    t.size = 0;
    this.applyTileVisibility(t);
  }

  async decodeToImage(bytes, mime, maxSize) {
    const blob = new Blob([bytes], { type: mime || "image/webp" });
    const bitmap = await createImageBitmap(blob);
    this.decodeCount++;
    const longest = Math.max(bitmap.width, bitmap.height);
    const s = longest > maxSize ? maxSize / longest : 1;
    if (s === 1) return bitmap; // native size — upload the bitmap directly
    const canvas = document.createElement("canvas");
    canvas.width = Math.max(1, Math.round(bitmap.width * s));
    canvas.height = Math.max(1, Math.round(bitmap.height * s));
    canvas.getContext("2d").drawImage(bitmap, 0, 0, canvas.width, canvas.height);
    bitmap.close();
    return canvas;
  }

  materialIndexOf(mesh, fallback) {
    const name = (mesh.material && mesh.material.name) || "";
    const m = /__tile_(\d+)/.exec(name);
    return m ? parseInt(m[1], 10) : fallback;
  }

  // --- GLB surgery ---------------------------------------------------------

  parseGLB(buffer) {
    const dv = new DataView(buffer);
    if (dv.getUint32(0, true) !== GLB_MAGIC) throw new Error("not a GLB");
    let off = 12;
    let json = null;
    let bin = null;
    while (off < dv.byteLength) {
      const len = dv.getUint32(off, true);
      const type = dv.getUint32(off + 4, true);
      const start = off + 8;
      if (type === CHUNK_JSON) {
        json = JSON.parse(
          new TextDecoder().decode(new Uint8Array(buffer, start, len))
        );
      } else if (type === CHUNK_BIN) {
        bin = new Uint8Array(buffer, start, len);
      }
      off = start + len; // GLB chunk lengths are already 4-byte aligned
    }
    if (!json || !bin) throw new Error("GLB missing JSON or BIN chunk");
    return { json, bin };
  }

  // material index -> { bytes, mime } for its base-colour webp.
  extractTileImages(json, bin) {
    const byMaterial = {};
    (json.materials || []).forEach((mat, i) => {
      const bct = mat.pbrMetallicRoughness?.baseColorTexture;
      if (!bct) return;
      const tex = json.textures?.[bct.index];
      if (!tex) return;
      let source = tex.source;
      if (tex.extensions?.[WEBP_EXT]) source = tex.extensions[WEBP_EXT].source;
      if (source == null) return;
      const image = json.images?.[source];
      if (!image || image.bufferView == null) return;
      const bv = json.bufferViews[image.bufferView];
      const start = bv.byteOffset || 0;
      byMaterial[i] = {
        bytes: bin.subarray(start, start + bv.byteLength),
        mime: image.mimeType || "image/webp",
      };
    });
    return byMaterial;
  }

  // Remove every image/texture reference so GLTFLoader decodes no images. Tag
  // each material with its index so tiles can be matched back to their webp.
  stripTextures(json) {
    const j = JSON.parse(JSON.stringify(json)); // structure only; bin is separate
    (j.materials || []).forEach((mat, i) => {
      mat.name = `__tile_${i}`;
      if (mat.pbrMetallicRoughness) {
        delete mat.pbrMetallicRoughness.baseColorTexture;
        delete mat.pbrMetallicRoughness.metallicRoughnessTexture;
      }
      delete mat.normalTexture;
      delete mat.occlusionTexture;
      delete mat.emissiveTexture;
    });
    delete j.images;
    delete j.textures;
    delete j.samplers;
    const dropWebp = (arr) =>
      Array.isArray(arr) ? arr.filter((e) => e !== WEBP_EXT) : arr;
    j.extensionsUsed = dropWebp(j.extensionsUsed);
    j.extensionsRequired = dropWebp(j.extensionsRequired);
    return j;
  }

  rebuildGLB(json, bin) {
    const jsonBytes = new TextEncoder().encode(JSON.stringify(json));
    const jsonPad = (4 - (jsonBytes.length % 4)) % 4;
    const binPad = (4 - (bin.length % 4)) % 4;
    const total =
      12 + 8 + jsonBytes.length + jsonPad + 8 + bin.length + binPad;

    const out = new ArrayBuffer(total);
    const dv = new DataView(out);
    const u8 = new Uint8Array(out);
    dv.setUint32(0, GLB_MAGIC, true);
    dv.setUint32(4, 2, true);
    dv.setUint32(8, total, true);

    let p = 12;
    dv.setUint32(p, jsonBytes.length + jsonPad, true);
    dv.setUint32(p + 4, CHUNK_JSON, true);
    p += 8;
    u8.set(jsonBytes, p);
    p += jsonBytes.length;
    for (let i = 0; i < jsonPad; i++) u8[p++] = 0x20; // pad JSON with spaces

    dv.setUint32(p, bin.length + binPad, true);
    dv.setUint32(p + 4, CHUNK_BIN, true);
    p += 8;
    u8.set(bin, p);
    p += bin.length;
    for (let i = 0; i < binPad; i++) u8[p++] = 0x00;

    return out;
  }

  parseGLTF(glb) {
    return new Promise((resolve, reject) => {
      this.gltfLoader.parse(glb, "", resolve, reject);
    });
  }
}
