import * as THREE from "three";

// Debug/visualisation overlays (enabled by ?debug / ?viz). Mixed onto
// MeshExplorer.prototype — these methods run with the app as `this`. Split out
// of main.js as instrumentation, not product surface: the LOD HUD text, the
// per-tile state tint, and the ground-plane load-zone rings.
export const hudMixin = {
  updateLODDebug() {
    let el = document.getElementById("lod-debug");
    if (!el) {
      el = document.createElement("div");
      el.id = "lod-debug";
      el.style.cssText =
        "position:fixed;bottom:4px;left:4px;z-index:2000;pointer-events:none;" +
        "font:10px/1.4 monospace;color:#0f0;background:rgba(0,0,0,.65);" +
        "padding:3px 6px;border-radius:4px;white-space:pre";
      document.body.appendChild(el);
    }
    const s = this.streamer;
    let native = 0;
    let ring = 0;
    let decoding = 0;
    for (const t of s.tiles) {
      if (t.state === "high") {
        if (t.size >= s.nativeSize && s.nativeSize > s.ringSize) native++;
        else ring++;
      }
      if (t.decoding) decoding++;
    }
    const mode = s.focusTiles
      ? "FOCUS(review)"
      : s.reviewOrbit
        ? "review(orbit-pick)"
        : s.spatialTiling
          ? "gaze"
          : "defer(atlas)";
    const ema = this._frameEMA == null ? 0 : this._frameEMA;
    const worst = this._frameWorst || 0;
    el.textContent =
      `LOD ${mode} · ${native} native + ${ring} ring / ${s.totalCap} · ` +
      `${decoding} decoding · ${s.uploadQueue.length} queued · ${s.decodeCount} total\n` +
      `sizes ring=${s.ringSize} native=${s.nativeSize} · deviceMemory=${navigator.deviceMemory ?? "n/a"}\n` +
      `range ×${s.rangeScale.toFixed(2)} → load ${s.loadRadius.toFixed(1)}u · reveal ${s.revealRadius.toFixed(1)}u · keep ${s.unloadDist}u  ([ / ] to tune)\n` +
      `motion ${s.camSpeed.toFixed(1)}u/s ${s.motionHold ? "· HELD (idle)" : "· streaming"}\n` +
      `frame ${ema.toFixed(1)}ms avg · worst ${worst.toFixed(0)}ms since last update`;
    this._frameWorst = 0;
  },

  // ?viz: tint each tile's material by its live streaming state. Tint means
  // "the streamer touched this"; untinted means base-only. A static green map
  // = streamer idle; flashing orange while flying = churn.
  updateVizTint() {
    const s = this.streamer;
    const matOf = (m) =>
      m && (Array.isArray(m.material) ? m.material[0] : m.material);
    for (const t of s.tiles) {
      for (const m of [t.mesh, t.low]) {
        const mat = matOf(m);
        if (!mat || !mat.color) continue;
        if (mat.userData._origColor === undefined) {
          mat.userData._origColor = mat.color.getHex();
        }
      }
      // Tint ONLY the enhanced overlay (renders where clusters reveal —
      // strictly local). Never tint the base mesh: it is the whole-map
      // scatter, and tinting it flashed every decode across the entire map.
      const tint =
        t.state === "high"
          ? t.size >= s.nativeSize
            ? 0x55ff55
            : 0xffee44
          : null;
      const hiMat = matOf(t.mesh);
      if (hiMat && hiMat.color) {
        hiMat.color.setHex(tint !== null ? tint : hiMat.userData._origColor);
      }
      const loMat = matOf(t.low);
      if (loMat && loMat.color && loMat.userData._origColor !== undefined) {
        loMat.color.setHex(loMat.userData._origColor);
      }
    }
  },

  // ?viz: wireframe rings on the ground showing the actual 3D-distance load
  // zone (green = native reach, yellow = ring reach). Because the thresholds
  // are true 3D distances, the ground-plane rings shrink as you climb —
  // at high altitude they vanish: nothing is close, nothing loads.
  updateVizRings() {
    const s = this.streamer;
    if (!s || !s.grid || s.spatialTiling) return;
    if (!this.vizRings) {
      const mkRing = (color) => {
        const pts = [];
        for (let i = 0; i <= 48; i++) {
          const a = (i / 48) * Math.PI * 2;
          pts.push(new THREE.Vector3(Math.cos(a), 0, Math.sin(a)));
        }
        const geom = new THREE.BufferGeometry().setFromPoints(pts);
        const mat = new THREE.LineBasicMaterial({ color, depthTest: false });
        const line = new THREE.Line(geom, mat);
        line.renderOrder = 1001;
        this.scene.add(line);
        return line;
      };
      this.vizRings = { native: mkRing(0x33ff33), ring: mkRing(0xffdd33) };
    }
    const cam = this.camera.position;
    const cell = s.cellOf(cam);
    const gy = s.cellY ? s.cellY[cell.cz * s.grid.n + cell.cx] : 0;
    const dy = cam.y - gy;
    const place = (line, R) => {
      const r = Math.sqrt(Math.max(0, R * R - dy * dy));
      line.visible = r > 0.05;
      line.position.set(cam.x, gy + 0.05, cam.z);
      line.scale.set(r, 1, r);
    };
    place(this.vizRings.native, s.loadRadius); // green: load radius (live-tuned)
    place(this.vizRings.ring, s.unloadDist); // yellow: keep-resident boundary
  },
};
