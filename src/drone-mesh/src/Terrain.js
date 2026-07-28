import * as THREE from "three";

// Bare-earth terrain approximation (a DTM) derived from the photogrammetry
// mesh (which is a DSM — surface *including* buildings and trees). We grid the
// XZ footprint, take a LOW percentile of surface height in each cell (bare
// ground shows through around/between structures), fill cells that saw no
// geometry, then smooth into a surface that follows the landscape's slopes and
// curves. Querying height-ABOVE-terrain then separates ground from elevated
// structures independent of absolute elevation — so ground high on a hill no
// longer reads as "roof" the way a single global floor datum made it.
//
// Caveat for dense settlements: where a cell has no visible bare ground the
// low percentile lands on rooftops, so the terrain sits high there and tall
// structures still separate but low ones may not. Good enough for the
// propose→human-verify auto-tag loop; a true DTM belongs in preprocessing.

// Progressive morphological filter params. maxWindow caps how large a
// structure we'll strip (in cells); maxSlope is the steepest real terrain we
// protect (rise per unit run) — lower removes buildings more aggressively but
// risks shaving narrow hills; baseThresh is the smallest bump treated as a
// structure at the finest scale.
const DEFAULTS = {
  grid: 40,
  percentile: 0.15,
  smoothPasses: 6,
  maxWindow: 12,
  maxSlope: 0.3,
  baseThresh: 0.15,
};

export class Terrain {
  constructor(h, minX, minZ, cellW, cellD, n, yMin, yMax) {
    this.h = h; // Float32Array(n*n) — terrain height per cell
    this.minX = minX;
    this.minZ = minZ;
    this.cellW = cellW;
    this.cellD = cellD;
    this.n = n;
    this.yMin = yMin; // DSM vertical extent, for a scale-aware clearance default
    this.yMax = yMax;
  }

  static build(root, opts = {}) {
    const { grid, percentile, smoothPasses, maxWindow, maxSlope, baseThresh } = {
      ...DEFAULTS,
      ...opts,
    };
    root.updateMatrixWorld(true);
    const box = new THREE.Box3().setFromObject(root);
    const minX = box.min.x;
    const minZ = box.min.z;
    const n = grid;
    const cellW = Math.max((box.max.x - minX) / n, 1e-6);
    const cellD = Math.max((box.max.z - minZ) / n, 1e-6);

    const buckets = Array.from({ length: n * n }, () => []);
    const v = new THREE.Vector3();
    root.traverse((m) => {
      if (!m.isMesh) return;
      const pos = m.geometry.getAttribute("position");
      if (!pos) return;
      // Cap sampling so a huge mesh doesn't stall the build; every vertex is
      // fine at these counts, but stay bounded for safety.
      const step = Math.max(1, Math.floor(pos.count / 300000));
      for (let i = 0; i < pos.count; i += step) {
        v.fromBufferAttribute(pos, i).applyMatrix4(m.matrixWorld);
        let cx = Math.floor((v.x - minX) / cellW);
        let cz = Math.floor((v.z - minZ) / cellD);
        cx = cx < 0 ? 0 : cx >= n ? n - 1 : cx;
        cz = cz < 0 ? 0 : cz >= n ? n - 1 : cz;
        buckets[cz * n + cx].push(v.y);
      }
    });

    const h = new Float32Array(n * n);
    const filled = new Uint8Array(n * n);
    let gMin = Infinity;
    for (let i = 0; i < n * n; i++) {
      const b = buckets[i];
      if (!b.length) continue;
      b.sort((a, c) => a - c);
      const val = b[Math.floor(b.length * percentile)];
      h[i] = val;
      filled[i] = 1;
      if (val < gMin) gMin = val;
    }
    if (!isFinite(gMin)) gMin = 0; // no geometry at all — degenerate mesh

    // Fill empty cells by iterative neighbour averaging (spreads inward from
    // known cells); anything still unreachable falls back to the global min.
    let empties = [];
    for (let i = 0; i < n * n; i++) if (!filled[i]) empties.push(i);
    let guard = 0;
    while (empties.length && guard++ < n * n) {
      const next = [];
      for (const i of empties) {
        const cx = i % n;
        const cz = (i / n) | 0;
        let s = 0;
        let c = 0;
        for (let dz = -1; dz <= 1; dz++) {
          for (let dx = -1; dx <= 1; dx++) {
            const nx = cx + dx;
            const nz = cz + dz;
            if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
            const j = nz * n + nx;
            if (filled[j]) {
              s += h[j];
              c++;
            }
          }
        }
        if (c) {
          h[i] = s / c;
          filled[i] = 1;
        } else {
          next.push(i);
        }
      }
      if (next.length === empties.length) {
        for (const i of next) {
          h[i] = gMin;
          filled[i] = 1;
        }
        break;
      }
      empties = next;
    }

    // Progressive morphological ground filter. Open (erode then dilate) with a
    // window that grows in steps; at each step a cell whose bump above the
    // opened surface exceeds an elevation threshold is a STRUCTURE and gets
    // lowered to ground. The threshold grows with window size (slope * the
    // horizontal distance the window now spans), so genuine terrain rise is
    // allowed while abrupt building jumps are stripped — at any footprint up to
    // maxWindow. Reaching ground under a big building's centre (that a single
    // small window can't) is exactly what a growing window buys us.
    const windowOp = (src, R, pick) => {
      const out = new Float32Array(n * n);
      for (let cz = 0; cz < n; cz++) {
        for (let cx = 0; cx < n; cx++) {
          let acc = pick === Math.min ? Infinity : -Infinity;
          for (let dz = -R; dz <= R; dz++) {
            for (let dx = -R; dx <= R; dx++) {
              const nx = cx + dx;
              const nz = cz + dz;
              if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
              acc = pick(acc, src[nz * n + nx]);
            }
          }
          out[cz * n + cx] = acc;
        }
      }
      return out;
    };
    const cellSize = (cellW + cellD) / 2;
    let cur = h;
    let R = 1;
    let prevR = 0;
    while (maxWindow > 0 && R <= maxWindow) {
      const opened = windowOp(windowOp(cur, R, Math.min), R, Math.max);
      // First step uses baseThresh; later steps allow terrain to have risen by
      // maxSlope over the newly-spanned horizontal distance.
      const dh = baseThresh + maxSlope * prevR * cellSize;
      for (let i = 0; i < n * n; i++) {
        if (cur[i] - opened[i] > dh) cur[i] = opened[i];
      }
      prevR = R;
      R *= 2;
    }

    // Smooth into a landscape-following surface (box blur, a few passes).
    for (let p = 0; p < smoothPasses; p++) {
      const out = new Float32Array(n * n);
      for (let cz = 0; cz < n; cz++) {
        for (let cx = 0; cx < n; cx++) {
          let s = 0;
          let c = 0;
          for (let dz = -1; dz <= 1; dz++) {
            for (let dx = -1; dx <= 1; dx++) {
              const nx = cx + dx;
              const nz = cz + dz;
              if (nx < 0 || nz < 0 || nx >= n || nz >= n) continue;
              s += cur[nz * n + nx];
              c++;
            }
          }
          out[cz * n + cx] = s / c;
        }
      }
      cur = out;
    }

    return new Terrain(cur, minX, minZ, cellW, cellD, n, box.min.y, box.max.y);
  }

  // Terrain height at a world XZ, bilinearly interpolated between cell centres.
  heightAt(x, z) {
    const n = this.n;
    const fx = (x - this.minX) / this.cellW - 0.5;
    const fz = (z - this.minZ) / this.cellD - 0.5;
    const x0 = Math.floor(fx);
    const z0 = Math.floor(fz);
    const tx = fx - x0;
    const tz = fz - z0;
    const cl = (i) => (i < 0 ? 0 : i >= n ? n - 1 : i);
    const H = (cx, cz) => this.h[cl(cz) * n + cl(cx)];
    const h00 = H(x0, z0);
    const h10 = H(x0 + 1, z0);
    const h01 = H(x0, z0 + 1);
    const h11 = H(x0 + 1, z0 + 1);
    const a = h00 * (1 - tx) + h10 * tx;
    const b = h01 * (1 - tx) + h11 * tx;
    return a * (1 - tz) + b * tz;
  }

  // Height of a world point above the local terrain (nDSM value).
  heightAbove(x, y, z) {
    return y - this.heightAt(x, z);
  }
}
