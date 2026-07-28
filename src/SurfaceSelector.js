import * as THREE from "three";
import { LineSegments2 } from "three/examples/jsm/lines/LineSegments2.js";
import { LineSegmentsGeometry } from "three/examples/jsm/lines/LineSegmentsGeometry.js";
import { LineMaterial } from "three/examples/jsm/lines/LineMaterial.js";

// Active-selection accent: a deliberately uncommon violet, distinct from the
// warm label palette, with a thick opaque outline so a pending selection is
// unmistakable over noisy photo texture.
const SEL_FILL = 0xa020ff;
const SEL_EDGE = 0xd400ff; // electric neon violet
const SEL_EDGE_PX = 5; // outline thickness in device px

const UP = new THREE.Vector3(0, 1, 0);

// Quantum used to bucket world-space vertex positions when matching
// boundary vertices across tiles. ~5mm in scene units — comfortably below
// any real feature size, generous enough to bridge tiny floating-point drift
// from photogrammetry tilers that re-mesh per tile.
const WORLD_POS_QUANTUM = 0.005;

// Hard cap on faces collected per selection — prevents pathological flood
// across an entire flat ground plane.
const MAX_FACES = 80000;

// Max angular deviation (degrees) between a candidate face normal and its
// plane cluster's normal. Keeps the selection on one physical plane unless
// the colour gate below admits an adjoining slope.
const NORMAL_TOLERANCE_DEG = 25;

// Ridge crossing: a face that fails every plane cluster's normal cone may
// still join if its texture colour is close to the selection's running mean
// (same tin roof, different slope). Distance is Euclidean RGB, 0-255 scale.
//
// DISABLED by default (Jul 2026): works nicely on roofs, but large roads
// bleed across their verges/embankments — dust-coloured tarmac vs
// dust-coloured ground gives the colour gate nothing to refuse. Re-enable
// once the gate compares against local neighbourhood colour instead of the
// selection-wide mean (or is restricted to pitched-roof seeds).
const ENABLE_RIDGE_CROSSING = false;
const COLOR_TOLERANCE = 42;

// Each colour-admitted slope becomes a new plane cluster. Bounded so a
// colour coincidence can't chain across the whole map — this is what keeps
// the merging "cautious".
const MAX_PLANE_CLUSTERS = 8;

// Per-tile texture is downsampled to this size for colour sampling (colour
// evidence doesn't need detail; keeps cached ImageData tiny).
const COLOR_SAMPLE_SIZE = 96;

export class SurfaceSelector {
  constructor(scene) {
    this.scene = scene;
    this.intraCache = new WeakMap();
    this.colorCache = new WeakMap(); // mesh -> {data} | null (null = no texture)
    this.globalGraph = null;
    this.globalGraphRoot = null;
    this.highlightMesh = null;
    // Instance flag so tests (and a future UI toggle) can opt in.
    this.enableRidgeCrossing = ENABLE_RIDGE_CROSSING;
  }

  invalidateGlobal() {
    this.globalGraph = null;
    this.globalGraphRoot = null;
  }

  ensureIntra(mesh) {
    const cached = this.intraCache.get(mesh);
    if (cached) return cached;

    const geom = mesh.geometry;
    const posAttr = geom.getAttribute("position");
    const index = geom.index;
    const faceCount = index ? index.count / 3 : posAttr.count / 3;

    const getVertIdx = index
      ? (face, corner) => index.getX(face * 3 + corner)
      : (face, corner) => face * 3 + corner;

    const edgeKey = (a, b) => (a < b ? a * 0x100000000 + b : b * 0x100000000 + a);

    const edgeToFaces = new Map();
    for (let f = 0; f < faceCount; f++) {
      const a = getVertIdx(f, 0);
      const b = getVertIdx(f, 1);
      const c = getVertIdx(f, 2);
      const e0 = edgeKey(a, b);
      const e1 = edgeKey(b, c);
      const e2 = edgeKey(c, a);
      let l;
      l = edgeToFaces.get(e0); if (l) l.push(f); else edgeToFaces.set(e0, [f]);
      l = edgeToFaces.get(e1); if (l) l.push(f); else edgeToFaces.set(e1, [f]);
      l = edgeToFaces.get(e2); if (l) l.push(f); else edgeToFaces.set(e2, [f]);
    }

    const boundaryVerts = new Set();
    for (const [e, faces] of edgeToFaces) {
      if (faces.length === 1) {
        // recover the two vertex indices from the packed key
        const a = Math.floor(e / 0x100000000);
        const b = e - a * 0x100000000;
        boundaryVerts.add(a);
        boundaryVerts.add(b);
      }
    }

    const entry = {
      faceCount,
      edgeToFaces,
      boundaryVerts,
      getVertIdx,
      edgeKey,
    };
    this.intraCache.set(mesh, entry);
    return entry;
  }

  posKey(v) {
    const q = WORLD_POS_QUANTUM;
    return `${Math.round(v.x / q)},${Math.round(v.y / q)},${Math.round(v.z / q)}`;
  }

  ensureGlobalGraph(root) {
    if (this.globalGraph && this.globalGraphRoot === root) return this.globalGraph;
    root.updateMatrixWorld(true);

    const graph = new Map();
    const tmp = new THREE.Vector3();

    root.traverse((child) => {
      if (!child.isMesh) return;
      const entry = this.ensureIntra(child);
      const posAttr = child.geometry.getAttribute("position");
      for (const v of entry.boundaryVerts) {
        tmp.fromBufferAttribute(posAttr, v).applyMatrix4(child.matrixWorld);
        const key = this.posKey(tmp);
        let list = graph.get(key);
        if (!list) { list = []; graph.set(key, list); }
        list.push({ mesh: child, vertexIdx: v });
      }
    });

    this.globalGraph = graph;
    this.globalGraphRoot = root;
    return graph;
  }

  faceWorldNormal(mesh, faceIdx, out = new THREE.Vector3()) {
    const entry = this.ensureIntra(mesh);
    const normalAttr = mesh.geometry.getAttribute("normal");
    out.set(0, 0, 0);

    if (normalAttr) {
      const tmp = new THREE.Vector3();
      for (let i = 0; i < 3; i++) {
        tmp.fromBufferAttribute(normalAttr, entry.getVertIdx(faceIdx, i));
        out.add(tmp);
      }
      out.normalize();
    } else {
      const posAttr = mesh.geometry.getAttribute("position");
      const v0 = new THREE.Vector3().fromBufferAttribute(posAttr, entry.getVertIdx(faceIdx, 0));
      const v1 = new THREE.Vector3().fromBufferAttribute(posAttr, entry.getVertIdx(faceIdx, 1));
      const v2 = new THREE.Vector3().fromBufferAttribute(posAttr, entry.getVertIdx(faceIdx, 2));
      out.crossVectors(v1.sub(v0), v2.sub(v0)).normalize();
    }

    out.transformDirection(mesh.matrixWorld).normalize();
    return out;
  }

  classify(worldNormal) {
    const upDot = worldNormal.dot(UP);
    const angle = (Math.acos(Math.min(1, Math.abs(upDot))) * 180) / Math.PI;
    if (angle < 20) return upDot > 0 ? "roof-flat" : "floor";
    if (angle > 70) return "wall";
    return upDot > 0 ? "roof-pitched" : "slope";
  }

  // Flat and pitched top surfaces are the same *family*: a hip roof's slopes
  // and its flat ridge cap should be mergeable, while walls stay walls.
  familyOf(cls) {
    return cls === "roof-flat" || cls === "roof-pitched" ? "top" : cls;
  }

  // Mean texture colour of a face ([r,g,b] 0-255), or null when colour
  // evidence is unavailable (untextured mesh, no UVs, headless test).
  faceColor(mesh, faceIdx) {
    let entry;
    if (this.colorCache.has(mesh)) {
      entry = this.colorCache.get(mesh);
    } else {
      entry = this.buildColorSampler(mesh);
      this.colorCache.set(mesh, entry);
    }
    if (!entry) return null;

    const uvAttr = mesh.geometry.getAttribute("uv");
    const intra = this.ensureIntra(mesh);
    let u = 0;
    let v = 0;
    for (let c = 0; c < 3; c++) {
      const vi = intra.getVertIdx(faceIdx, c);
      u += uvAttr.getX(vi);
      v += uvAttr.getY(vi);
    }
    u /= 3;
    v /= 3;
    u -= Math.floor(u); // wrap
    v -= Math.floor(v);

    const s = COLOR_SAMPLE_SIZE;
    // glTF UV origin is top-left (textures load with flipY=false), matching
    // canvas ImageData row order — no flip needed.
    const x = Math.min(s - 1, Math.floor(u * s));
    const y = Math.min(s - 1, Math.floor(v * s));
    const i = (y * s + x) * 4;
    return [entry.data[i], entry.data[i + 1], entry.data[i + 2]];
  }

  buildColorSampler(mesh) {
    try {
      const img = mesh.material && mesh.material.map && mesh.material.map.image;
      const uvAttr = mesh.geometry.getAttribute("uv");
      if (!img || !uvAttr || typeof document === "undefined") return null;
      const s = COLOR_SAMPLE_SIZE;
      const canvas = document.createElement("canvas");
      canvas.width = s;
      canvas.height = s;
      const ctx = canvas.getContext("2d", { willReadFrequently: true });
      ctx.drawImage(img, 0, 0, s, s);
      return { data: ctx.getImageData(0, 0, s, s).data };
    } catch (err) {
      return null; // e.g. CORS-tainted canvas — colour assist just disables
    }
  }

  select(intersection, root) {
    const hitMesh = intersection.object;
    const hitFaceIdx = intersection.faceIndex;
    if (hitFaceIdx == null) return null;

    this.ensureGlobalGraph(root);

    const targetNormal = this.faceWorldNormal(hitMesh, hitFaceIdx).clone();
    const targetClass = this.classify(targetNormal);
    const targetFamily = this.familyOf(targetClass);
    const tolDot = Math.cos((NORMAL_TOLERANCE_DEG * Math.PI) / 180);

    // Plane clusters: the seed plane, plus any adjoining slope admitted via
    // the colour gate (e.g. the far side of a pitched roof — geometry says
    // "different plane", texture says "same tin sheet").
    const clusters = [targetNormal];
    const colorSum = [0, 0, 0];
    let colorN = 0;
    const addColor = (c) => {
      colorSum[0] += c[0];
      colorSum[1] += c[1];
      colorSum[2] += c[2];
      colorN++;
    };
    const colorDist = (c) => {
      const r = colorSum[0] / colorN - c[0];
      const g = colorSum[1] / colorN - c[1];
      const b = colorSum[2] / colorN - c[2];
      return Math.sqrt(r * r + g * g + b * b);
    };
    const seedColor = this.enableRidgeCrossing
      ? this.faceColor(hitMesh, hitFaceIdx)
      : null;
    const colorAssist = seedColor !== null;
    if (colorAssist) addColor(seedColor);

    const selected = new Map();
    const seen = new Map();
    const queue = [{ mesh: hitMesh, faceIdx: hitFaceIdx }];
    let totalSelected = 0;
    const candidateNormal = new THREE.Vector3();
    const tmpV = new THREE.Vector3();

    const markSeen = (mesh, faceIdx) => {
      let s = seen.get(mesh);
      if (!s) { s = new Set(); seen.set(mesh, s); }
      if (s.has(faceIdx)) return true;
      s.add(faceIdx);
      return false;
    };

    while (queue.length && totalSelected < MAX_FACES) {
      const { mesh, faceIdx } = queue.pop();
      if (markSeen(mesh, faceIdx)) continue;

      this.faceWorldNormal(mesh, faceIdx, candidateNormal);
      const candidateClass = this.classify(candidateNormal);
      // Crossing off = v1 semantics: exact class match. Crossing on relaxes
      // to the class family so flat ridge caps can join pitched slopes.
      if (this.enableRidgeCrossing) {
        if (this.familyOf(candidateClass) !== targetFamily) continue;
      } else if (candidateClass !== targetClass) {
        continue;
      }

      const col = colorAssist ? this.faceColor(mesh, faceIdx) : null;

      let accepted = false;
      for (const cn of clusters) {
        if (candidateNormal.dot(cn) >= tolDot) {
          accepted = true;
          break;
        }
      }
      if (
        !accepted &&
        col &&
        clusters.length < MAX_PLANE_CLUSTERS &&
        colorDist(col) <= COLOR_TOLERANCE
      ) {
        // Ridge crossing: same colour, new plane — admit cautiously.
        clusters.push(candidateNormal.clone());
        accepted = true;
      }
      if (!accepted) continue;
      if (col) addColor(col);

      let sel = selected.get(mesh);
      if (!sel) { sel = new Set(); selected.set(mesh, sel); }
      sel.add(faceIdx);
      totalSelected++;

      const entry = this.ensureIntra(mesh);
      const a = entry.getVertIdx(faceIdx, 0);
      const b = entry.getVertIdx(faceIdx, 1);
      const c = entry.getVertIdx(faceIdx, 2);
      const edges = [
        [a, b, entry.edgeKey(a, b)],
        [b, c, entry.edgeKey(b, c)],
        [c, a, entry.edgeKey(c, a)],
      ];

      for (const [v1, v2, ek] of edges) {
        const neighbours = entry.edgeToFaces.get(ek);
        if (neighbours) {
          for (const nf of neighbours) {
            if (nf !== faceIdx) queue.push({ mesh, faceIdx: nf });
          }
        }
        // Open edge (tile border OR intra-tile UV seam): try to continue
        // through co-located vertices in the global boundary graph.
        if (
          (!neighbours || neighbours.length === 1) &&
          entry.boundaryVerts.has(v1) &&
          entry.boundaryVerts.has(v2)
        ) {
          this._enqueueCrossTile(mesh, v1, v2, queue, tmpV);
        }
      }
    }

    return { selected, targetClass, targetNormal, totalSelected };
  }

  // Bridge an open edge to co-located geometry elsewhere: either the matching
  // edge of an adjacent tile, or a duplicate-vertex UV seam inside the SAME
  // tile. Photogrammetry texturing (ODM et al.) splits vertices along texture
  // chart borders, so a physically continuous roof is often several
  // disconnected islands even within one tile — both cases look the same:
  // an open edge whose endpoints coincide in world space with another edge's.
  _enqueueCrossTile(mesh, localV1, localV2, queue, tmpV) {
    const posAttr = mesh.geometry.getAttribute("position");

    tmpV.fromBufferAttribute(posAttr, localV1).applyMatrix4(mesh.matrixWorld);
    const key1 = this.posKey(tmpV);
    tmpV.fromBufferAttribute(posAttr, localV2).applyMatrix4(mesh.matrixWorld);
    const key2 = this.posKey(tmpV);

    const others1 = this.globalGraph.get(key1);
    const others2 = this.globalGraph.get(key2);
    if (!others1 || !others2) return;

    // Bucket key2's hits by mesh so we can pair them up cheaply. Same-mesh
    // entries stay in — they are how intra-tile UV seams get stitched. The
    // edge also pairs with itself, but those faces are already in the seen
    // set, so the flood fill absorbs the redundancy.
    const meshToV2 = new Map();
    for (const { mesh: m, vertexIdx } of others2) {
      let arr = meshToV2.get(m);
      if (!arr) { arr = []; meshToV2.set(m, arr); }
      arr.push(vertexIdx);
    }

    for (const { mesh: otherMesh, vertexIdx: otherV1 } of others1) {
      const otherV2s = meshToV2.get(otherMesh);
      if (!otherV2s) continue;

      const otherEntry = this.ensureIntra(otherMesh);
      for (const otherV2 of otherV2s) {
        if (otherMesh === mesh && otherV1 === localV1 && otherV2 === localV2) {
          continue; // the originating edge itself
        }
        const ek = otherEntry.edgeKey(otherV1, otherV2);
        const faces = otherEntry.edgeToFaces.get(ek);
        if (!faces) continue;
        for (const f of faces) queue.push({ mesh: otherMesh, faceIdx: f });
      }
    }
  }

  buildHighlight(selected) {
    const positions = [];
    const tmpV = new THREE.Vector3();
    const fn = new THREE.Vector3();

    // boundary outline: edges belonging to exactly one selected face, keyed
    // by quantized world position so tile borders / UV seams read as one loop
    // fill sits on the surface (polygonOffset handles z-fighting); only the
    // outline is lifted a hair. Edges dedup by RAW position so seams merge.
    const LIFT = 0.004;
    const edges = new Map();
    const lift = [[0, 0, 0], [0, 0, 0], [0, 0, 0]];
    // Identify each corner by the SAME canonical identity the flood uses so
    // "interior vs boundary" agrees with the selection topology: a seam vertex
    // is its 5 mm world-position cell (shared across tiles/UV splits), an
    // interior vertex is its per-mesh local index. An edge shared by two
    // selected faces then cancels (count 2) even across a stitched seam, so
    // only the true outer silhouette + real holes get drawn.
    // Cancel interior edges even across tile seams whose duplicate vertices
    // don't perfectly coincide: ODM reconstructs the same ground at slightly
    // different heights per tile, so cross-tile seam verts sit centimetres
    // apart. Cluster boundary verts by proximity — an order of magnitude
    // looser than the flood's bridging quantum — with a neighbour check so a
    // pair straddling a cell border still merges. Interior verts keep their
    // per-mesh index (already shared by both faces within a tile).
    const MERGE_Q = WORLD_POS_QUANTUM * 12; // vs the flood's 5 mm quantum
    const canon = new Map();
    let canonN = 0;
    const canonicalId = (v) => {
      const cx = Math.round(v.x / MERGE_Q);
      const cy = Math.round(v.y / MERGE_Q);
      const cz = Math.round(v.z / MERGE_Q);
      const self = `${cx},${cy},${cz}`;
      let rep = canon.get(self);
      if (rep !== undefined) return rep;
      for (let dx = -1; dx <= 1; dx++)
        for (let dy = -1; dy <= 1; dy++)
          for (let dz = -1; dz <= 1; dz++) {
            rep = canon.get(`${cx + dx},${cy + dy},${cz + dz}`);
            if (rep !== undefined) {
              canon.set(self, rep);
              return rep;
            }
          }
      rep = canonN++;
      canon.set(self, rep);
      return rep;
    };
    const vkey = (mesh, entry, vi) =>
      entry.boundaryVerts.has(vi) ? `w${canonicalId(tmpV)}` : `${mesh.id}:${vi}`;
    const addEdge = (ka, kb, li, lj) => {
      const key = ka < kb ? `${ka}|${kb}` : `${kb}|${ka}`;
      const e = edges.get(key);
      if (e) e.count++;
      else edges.set(key, { count: 1, a: li.slice(), b: lj.slice() });
    };

    for (const [mesh, faceSet] of selected) {
      const entry = this.ensureIntra(mesh);
      const posAttr = mesh.geometry.getAttribute("position");

      for (const f of faceSet) {
        this.faceWorldNormal(mesh, f, fn);
        const vk = ["", "", ""];
        for (let i = 0; i < 3; i++) {
          const vi = entry.getVertIdx(f, i);
          tmpV.fromBufferAttribute(posAttr, vi).applyMatrix4(mesh.matrixWorld);
          lift[i][0] = tmpV.x + fn.x * LIFT;
          lift[i][1] = tmpV.y + fn.y * LIFT;
          lift[i][2] = tmpV.z + fn.z * LIFT;
          positions.push(tmpV.x, tmpV.y, tmpV.z); // fill on surface
          vk[i] = vkey(mesh, entry, vi);
        }
        addEdge(vk[0], vk[1], lift[0], lift[1]);
        addEdge(vk[1], vk[2], lift[1], lift[2]);
        addEdge(vk[2], vk[0], lift[2], lift[0]);
      }
    }

    const geom = new THREE.BufferGeometry();
    geom.setAttribute("position", new THREE.Float32BufferAttribute(positions, 3));

    const mat = new THREE.MeshBasicMaterial({
      color: SEL_FILL,
      transparent: true,
      opacity: 0.5,
      toneMapped: false, // keep the neon violet at full intensity
      side: THREE.DoubleSide,
      // depthWrite TRUE: self-occlude (no near/far-slope band interleaving);
      // polygonOffset below any label overlay so an in-progress selection
      // always reads on top of an existing label on the same surface.
      depthWrite: true,
      polygonOffset: true,
      polygonOffsetFactor: -6,
      polygonOffsetUnits: -6,
    });

    const mesh = new THREE.Mesh(geom, mat);
    mesh.renderOrder = 999;
    mesh.raycast = () => {};

    const linePos = [];
    for (const e of edges.values()) {
      if (e.count === 1) linePos.push(e.a[0], e.a[1], e.a[2], e.b[0], e.b[1], e.b[2]);
    }
    if (linePos.length) {
      const lgeom = new LineSegmentsGeometry();
      lgeom.setPositions(linePos);
      // Fat lines (screen-space px width). LineBasicMaterial.linewidth is
      // ignored on almost every GPU, so use LineMaterial for a real thick edge.
      const lmat = new LineMaterial({
        color: SEL_EDGE,
        linewidth: SEL_EDGE_PX,
        transparent: false,
        toneMapped: false, // full-intensity neon, unmuted by tone mapping
        depthWrite: false, // sit over the fill; the lifted verts keep it crisp
      });
      const w = this._resW || (typeof window !== "undefined" ? window.innerWidth : 1);
      const h = this._resH || (typeof window !== "undefined" ? window.innerHeight : 1);
      lmat.resolution.set(w, h);
      this._lineMat = lmat; // kept so a resize can refresh its resolution
      const line = new LineSegments2(lgeom, lmat);
      line.renderOrder = 1000;
      line.raycast = () => {};
      mesh.add(line);
    }
    return mesh;
  }

  clearHighlight() {
    if (!this.highlightMesh) return;
    this.scene.remove(this.highlightMesh);
    this.highlightMesh.children.forEach((c) => {
      c.geometry.dispose();
      c.material.dispose();
    });
    this.highlightMesh.geometry.dispose();
    this.highlightMesh.material.dispose();
    this.highlightMesh = null;
    this._lineMat = null;
  }

  // Fat-line outlines need the viewport size in px; refresh it on resize.
  setLineResolution(w, h) {
    this._resW = w;
    this._resH = h;
    if (this._lineMat) this._lineMat.resolution.set(w, h);
  }

  // Flood from a seed face along edge adjacency (incl. cross-tile / UV-seam
  // bridges), keeping neighbours for which accept(mesh, faceIdx) is true. The
  // SEED is always included (it's the raycast-frontmost face under the
  // cursor). The brush uses accept = "in the cursor disc AND within a depth
  // band of the hit surface", so it grows along the visible surface and can't
  // reach faces behind it or on a different surface.
  floodFromFace(seedMesh, seedFace, accept, root) {
    this.ensureGlobalGraph(root);
    const result = new Map();
    const queue = [];
    const tmpV = new THREE.Vector3();
    const add = (mesh, f, forced) => {
      if (!forced && !accept(mesh, f)) return;
      let s = result.get(mesh);
      if (!s) { s = new Set(); result.set(mesh, s); }
      if (s.has(f)) return;
      s.add(f);
      queue.push({ mesh, faceIdx: f });
    };
    add(seedMesh, seedFace, true); // seed always in
    while (queue.length) {
      const { mesh, faceIdx } = queue.pop();
      const entry = this.ensureIntra(mesh);
      const a = entry.getVertIdx(faceIdx, 0);
      const b = entry.getVertIdx(faceIdx, 1);
      const c = entry.getVertIdx(faceIdx, 2);
      for (const [v1, v2, ek] of [
        [a, b, entry.edgeKey(a, b)],
        [b, c, entry.edgeKey(b, c)],
        [c, a, entry.edgeKey(c, a)],
      ]) {
        const neigh = entry.edgeToFaces.get(ek);
        if (neigh) for (const nf of neigh) if (nf !== faceIdx) add(mesh, nf);
        if (
          (!neigh || neigh.length === 1) &&
          entry.boundaryVerts.has(v1) &&
          entry.boundaryVerts.has(v2)
        ) {
          const bridge = [];
          this._enqueueCrossTile(mesh, v1, v2, bridge, tmpV);
          for (const q of bridge) add(q.mesh, q.faceIdx);
        }
      }
    }
    return result;
  }

  // Faces of `allowed` reachable from `seeds` by edge adjacency (incl.
  // cross-tile / UV-seam bridges). (Retained utility.)
  connectedWithin(seeds, allowed, root) {
    this.ensureGlobalGraph(root);
    const result = new Map();
    const queue = [];
    const tmpV = new THREE.Vector3();
    const push = (mesh, f) => {
      const s = allowed.get(mesh);
      if (!s || !s.has(f)) return;
      let r = result.get(mesh);
      if (!r) { r = new Set(); result.set(mesh, r); }
      if (r.has(f)) return;
      r.add(f);
      queue.push({ mesh, faceIdx: f });
    };
    for (const [mesh, set] of seeds) for (const f of set) push(mesh, f);
    while (queue.length) {
      const { mesh, faceIdx } = queue.pop();
      const entry = this.ensureIntra(mesh);
      const a = entry.getVertIdx(faceIdx, 0);
      const b = entry.getVertIdx(faceIdx, 1);
      const c = entry.getVertIdx(faceIdx, 2);
      for (const [v1, v2, ek] of [
        [a, b, entry.edgeKey(a, b)],
        [b, c, entry.edgeKey(b, c)],
        [c, a, entry.edgeKey(c, a)],
      ]) {
        const neigh = entry.edgeToFaces.get(ek);
        if (neigh) for (const nf of neigh) if (nf !== faceIdx) push(mesh, nf);
        if (
          (!neigh || neigh.length === 1) &&
          entry.boundaryVerts.has(v1) &&
          entry.boundaryVerts.has(v2)
        ) {
          const bridge = [];
          this._enqueueCrossTile(mesh, v1, v2, bridge, tmpV);
          for (const q of bridge) push(q.mesh, q.faceIdx);
        }
      }
    }
    return result;
  }

  // Grow the selection by one adjacency ring: every edge-neighbour (incl.
  // across tile borders and UV seams) joins. Deliberately unconstrained by
  // class/normal — grow is the user's manual override for undershoot.
  growSelection(selectedMap, root) {
    this.ensureGlobalGraph(root);
    const out = new Map();
    const tmpV = new THREE.Vector3();
    const bridge = [];
    for (const [mesh, faces] of selectedMap) out.set(mesh, new Set(faces));
    const addFace = (mesh, f) => {
      let s = out.get(mesh);
      if (!s) {
        s = new Set();
        out.set(mesh, s);
      }
      s.add(f);
    };
    for (const [mesh, faces] of selectedMap) {
      const entry = this.ensureIntra(mesh);
      for (const f of faces) {
        const a = entry.getVertIdx(f, 0);
        const b = entry.getVertIdx(f, 1);
        const c = entry.getVertIdx(f, 2);
        for (const [v1, v2, ek] of [
          [a, b, entry.edgeKey(a, b)],
          [b, c, entry.edgeKey(b, c)],
          [c, a, entry.edgeKey(c, a)],
        ]) {
          const neigh = entry.edgeToFaces.get(ek);
          if (neigh) for (const nf of neigh) if (nf !== f) addFace(mesh, nf);
          if (
            (!neigh || neigh.length === 1) &&
            entry.boundaryVerts.has(v1) &&
            entry.boundaryVerts.has(v2)
          ) {
            bridge.length = 0;
            this._enqueueCrossTile(mesh, v1, v2, bridge, tmpV);
            for (const q of bridge) addFace(q.mesh, q.faceIdx);
          }
        }
      }
    }
    return out;
  }

  // Shrink by one ring: keep only faces whose every edge-neighbour (bridged
  // neighbours included) is also selected. Faces on a physically open mesh
  // edge count as boundary and shrink away — standard erosion semantics.
  shrinkSelection(selectedMap, root) {
    this.ensureGlobalGraph(root);
    const has = (mesh, f) => {
      const s = selectedMap.get(mesh);
      return s ? s.has(f) : false;
    };
    const out = new Map();
    const tmpV = new THREE.Vector3();
    const bridge = [];
    for (const [mesh, faces] of selectedMap) {
      const entry = this.ensureIntra(mesh);
      const keep = new Set();
      for (const f of faces) {
        let interior = true;
        const a = entry.getVertIdx(f, 0);
        const b = entry.getVertIdx(f, 1);
        const c = entry.getVertIdx(f, 2);
        for (const [v1, v2, ek] of [
          [a, b, entry.edgeKey(a, b)],
          [b, c, entry.edgeKey(b, c)],
          [c, a, entry.edgeKey(c, a)],
        ]) {
          const neigh = entry.edgeToFaces.get(ek);
          if (neigh && neigh.length > 1) {
            for (const nf of neigh) {
              if (nf !== f && !has(mesh, nf)) {
                interior = false;
                break;
              }
            }
          } else if (entry.boundaryVerts.has(v1) && entry.boundaryVerts.has(v2)) {
            bridge.length = 0;
            this._enqueueCrossTile(mesh, v1, v2, bridge, tmpV);
            if (bridge.length === 0) interior = false; // true open edge
            else {
              for (const q of bridge) {
                if (!has(q.mesh, q.faceIdx)) {
                  interior = false;
                  break;
                }
              }
            }
          } else {
            interior = false; // unbridged open edge = selection boundary
          }
          if (!interior) break;
        }
        if (interior) keep.add(f);
      }
      if (keep.size) out.set(mesh, keep);
    }
    return out;
  }

  // Display an arbitrary mesh→faceSet map as the current highlight. Used by
  // the labeling flow, which merges several select() results (shift-click)
  // before committing them as one label.
  showFaces(selectedMap) {
    this.clearHighlight();
    if (!selectedMap || selectedMap.size === 0) return;
    this.highlightMesh = this.buildHighlight(selectedMap);
    this.scene.add(this.highlightMesh);
  }

  highlight(intersection, root) {
    const result = this.select(intersection, root);
    if (!result || result.selected.size === 0) {
      this.clearHighlight();
      return null;
    }

    this.showFaces(result.selected);

    return {
      faceCount: result.totalSelected,
      tileCount: result.selected.size,
      classification: result.targetClass,
      normal: result.targetNormal,
    };
  }
}
