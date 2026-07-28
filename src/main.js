import * as THREE from "three";
import { FirstPersonControls } from "./FirstPersonControls.js";
import { MeshLoader } from "./MeshLoader.js";
import { autoTag } from "./AutoTagger.js";
import { Diagnostics } from "./Diagnostics.js";
import { hudMixin } from "./app/hud.js";
import { loadingMixin } from "./app/loading.js";
import { inspectMixin } from "./app/inspect.js";
import { ChromeController } from "./app/ChromeController.js";
import { ReviewController } from "./app/ReviewController.js";
import { LabelingController } from "./app/LabelingController.js";
import { SelectionController } from "./app/SelectionController.js";

// The high-res model is 130 tiles, each with its own ~2048x2048 texture. Decoded
// to GPU memory that is ~2.5 GB of VRAM all at once - far beyond what any tablet
// or most laptops can hold, so uploading them all loses the WebGL context (black
// tiles / blank screen / reload loop).
//
// Instead of a wholesale swap we stream textures by proximity (LOD): the low-res
// preview stays as the always-resident base, and only the nearest tiles are
// promoted to a high-res texture, capped so resident high-res VRAM stays bounded.
// Promoted tiles are downscaled to MAX_TEXTURE_SIZE; far tiles have their high-res
// texture disposed (VRAM freed, source image kept for cheap re-upload).
// Tiered gaze-bubble profiles (see HighResStreamer): a few NATIVE-res tiles
// where the user looks, a 1024 ring around them, base elsewhere. Native
// uploads are rare + throttled to one per frame, so quality no longer trades
// against smooth navigation. Touch keeps everything at 1024 (memory), which
// collapses the tiers into a single gaze-targeted bubble.
// NOTE (Jul 2026, measured): this map's "tiles" are ODM atlas pages that each
// span the ENTIRE site. The streamer detects that and uses a face-level
// spatial index for deferred-until-needed loading: pages with geometry near
// the camera/gaze promote (native inner radius, ring outer), everything else
// stays base until approached, demoting when left behind. Caps are sized for
// "how many pages a neighbourhood touches", not tile counts.
// ONE strategy for every device: deferred single-tier loading — nothing
// speculative, native-quality textures only near the camera. Hardware
// evidence changes COVERAGE (caps = how many pages may be resident), never
// the strategy and never the quality ceiling. Caps are the safety net; the
// 3D-distance reach is what actually bounds residency.
// keepDist = retention radius: how far you can back away before resident
// textures evict. Validated hardware keeps most of a session's visited area
// warm (the texture is already paid for — retention is the cheap luxury);
// lite devices evict aggressively.
// Lite native is 1024, not 2048: one locale of scattered atlas pages needs
// ~20-40 pages resident, and cheap devices can afford that ONLY at 1024
// (≈5.6 MB/page vs 22). Full local coverage at good quality beats patchy
// coverage at max quality — the earlier 6-page cap starved neighbourhoods.
// Touch memory is reclaimed mostly by the STATIC savers (256² base layer +
// 1.5 pixel ratio, both below) rather than by starving the stream — so the
// resident-page budget stays generous enough that what you look at actually
// sharpens. ~32×1024² ≈ 240 MB streamed + ~45 MB base sits well under iOS's
// kill threshold.
const LITE_CAPS = { nativeSize: 1024, ringSize: 1024, nativeCap: 20, totalCap: 32, keepDist: 14 };
const RICH_CAPS = { nativeSize: 2048, ringSize: 1024, nativeCap: 32, totalCap: 128, keepDist: 45 };
const LOD_UPDATE_INTERVAL = 12; // frames between LOD re-evaluations

// Bump on every meaningful change. Shown in the info panel and logged at startup
// so it's possible to confirm the live preview is actually running current code
// (vs a stale cached bundle).
const BUILD_VERSION = "terrain-inspector-1";

class MeshExplorer {
  constructor() {
    console.log(`[drone-mesh] build ${BUILD_VERSION}`);
    // crash/error reporting first, so it captures anything during init.
    // window.dmtDiag() dumps the persisted log.
    this.diag = new Diagnostics(BUILD_VERSION);
    window.dmtDiag = () => this.diag.dump();
    this.scene = null;
    this.camera = null;
    this.renderer = null;
    this.controls = null;
    this.meshLoader = null;
    this.currentMesh = null;
    this.lowResMesh = null;
    this.isLoadingHighRes = false;
    this.currentFiles = null;

    // High-res texture streaming (see HighResStreamer).
    this.streamer = null;
    this.frameCount = 0;

    // Surface selection & labeling. `pending` is the not-yet-saved selection
    // (possibly merged from several shift-clicks); saved labels live in
    // LabelManager. Both are created once the mesh is ready.
    this.raycaster = new THREE.Raycaster();
    this.mouse = new THREE.Vector2();
    this.selector = null;
    this.labels = null;
    this.pending = null;

    // "explore" = free-roam + click-to-label; "review" = one queue item at a
    // time under an orbit camera with scoped tile rendering.
    this.mode = "explore";
    this.orbit = null;
    this.review = null;

    // Selection refinement state: undo history (snapshots of the pending face
    // map, capped) and the label being edited in place. The editing model's
    // two axes — intent (add/remove) × tool (navigate/tap/brush/lasso) — are
    // owned by ChromeController now; read via this.chrome.editIntent/.editTool.
    this.paint = null;
    this.pendingHistory = [];
    this.editingLabelId = null;

    // Explore classifier inspector (see app/inspect.js): tapping a surface
    // shows the class auto-tag would assign it, with its reasoning. The
    // bare-earth terrain (DTM) it needs is built lazily on first tap + cached.
    this.inspectMode = true;
    this.terrain = null;

    // App-as-coordinator controllers (own their slice of state; reach `this`
    // for shared state). reviewCtl coordinates the ReviewMode engine (this.review).
    this.chrome = new ChromeController(this);
    this.reviewCtl = new ReviewController(this);
    this.labelingCtl = new LabelingController(this);
    this.selectionCtl = new SelectionController(this);

    this.init();
    this.setupEventListeners();
    this.animate();

    // URL surface, deliberately tiny:
    //   (nothing) — the experience. Local files auto-detected, else CDN.
    //   ?debug    — HUD + state tinting + load-zone rings, all of it.
    //   ?full     — ground truth: whole GLB, no pipeline.
    // (?tex/?ring/?tiles/?lite/?hq/?local remain as undocumented tuning.)
    const params = new URLSearchParams(location.search);
    const dbg = params.has("debug") || params.has("viz");
    this.debugLOD = dbg;
    this.debugViz = dbg;

    // LITE IS THE DEFAULT — for every device, always. The rich profile is
    // opt-IN via progressive enhancement: granted only on POSITIVE hardware
    // evidence (reported memory or a recognisably capable GPU), never on
    // touch devices (thermals), never on unknown hardware. Overrides:
    // ?hq forces rich, ?lite forces lite.
    const isTouch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    let gpu = "";
    try {
      const gl = this.renderer.getContext();
      const info = gl.getExtension("WEBGL_debug_renderer_info");
      gpu = String(
        info ? gl.getParameter(info.UNMASKED_RENDERER_WEBGL) : gl.getParameter(gl.RENDERER)
      );
    } catch (e) {
      /* no evidence → stay lite */
    }
    const memoryOK = (navigator.deviceMemory || 0) >= 8;
    const gpuOK = /apple m\d|rtx|geforce|radeon pro|radeon rx|nvidia/i.test(gpu);
    const validated = !isTouch && (memoryOK || gpuOK);
    const rich = params.has("hq") || (validated && !params.has("lite"));
    const base = rich ? RICH_CAPS : LITE_CAPS;
    console.log(
      `[drone-mesh] coverage: ${rich ? "RICH (validated hardware)" : "LITE (default)"} · ` +
        `gpu="${gpu}" · deviceMemory=${navigator.deviceMemory ?? "n/a"} · ` +
        `same strategy + native quality either way`
    );
    // Uniform (atlas) maps hold ALL pages at ringSize, so ringSize IS the
    // close-up quality. Desktop = native 2048 unconditionally (~2.9 GB
    // textures, Blender parity; measured source: 107×2048 + 23×1024).
    // Weaker machines can pass ?ring=1024 — no silent downgrades.
    this.streamProfile = {
      ...base,
      nativeSize: parseInt(params.get("tex"), 10) || base.nativeSize,
      ringSize: parseInt(params.get("ring"), 10) || base.ringSize,
      totalCap: parseInt(params.get("tiles"), 10) || base.totalCap,
    };
    console.log(
      `[drone-mesh] stream caps: ${this.streamProfile.nativeCap} native @ ${this.streamProfile.nativeSize}px, total ${this.streamProfile.totalCap}`
    );
    this.startLoading(params);
  }

  init() {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0x87ceeb);
    this.scene.fog = new THREE.Fog(0x87ceeb, 10, 1000);

    // near/far ratio drives depth precision. The mesh normalizes to a 50-unit
    // box, so a 0.1 near against 2000 far (ratio 20000) wastes precision and
    // z-fights overlays; 0.3/1200 keeps ~4× the precision while still letting
    // the camera get close to a building without clipping.
    this.camera = new THREE.PerspectiveCamera(
      75,
      window.innerWidth / window.innerHeight,
      0.3,
      1200
    );
    this.camera.position.set(0, 5, 10);

    this.renderer = new THREE.WebGLRenderer({ antialias: true, powerPreference: "high-performance" });
    this.renderer.setSize(window.innerWidth, window.innerHeight);
    // Cap pixel ratio hard on touch: the framebuffer costs scale with DPR²,
    // and a 3× retina phone framebuffer is a big chunk of the memory that
    // gets the tab killed. 1.5 is plenty at arm's length.
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    this.renderer.setPixelRatio(Math.min(window.devicePixelRatio || 1, touch ? 1.5 : 2));
    this.renderer.shadowMap.enabled = true;
    this.renderer.shadowMap.type = THREE.PCFSoftShadowMap;

    const container = document.getElementById("canvas-container");
    container.appendChild(this.renderer.domElement);

    // Handle WebGL context loss gracefully instead of leaving a blank screen.
    this.contextLost = false;
    const canvas = this.renderer.domElement;
    canvas.addEventListener(
      "webglcontextlost",
      (event) => {
        // preventDefault lets the browser attempt to restore the context.
        event.preventDefault();
        this.contextLost = true;
        if (this.diag) this.diag.noteContextLost();
      },
      false
    );
    canvas.addEventListener(
      "webglcontextrestored",
      () => {
        this.contextLost = false;
        console.warn("WebGL context restored");
      },
      false
    );

    this.controls = new FirstPersonControls(
      this.camera,
      this.renderer.domElement
    );

    const ambientLight = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambientLight);

    const directionalLight = new THREE.DirectionalLight(0xffffff, 0.8);
    directionalLight.position.set(50, 100, 50);
    directionalLight.castShadow = true;
    directionalLight.shadow.camera.left = -100;
    directionalLight.shadow.camera.right = 100;
    directionalLight.shadow.camera.top = 100;
    directionalLight.shadow.camera.bottom = -100;
    directionalLight.shadow.camera.near = 0.1;
    directionalLight.shadow.camera.far = 200;
    directionalLight.shadow.mapSize.width = 2048;
    directionalLight.shadow.mapSize.height = 2048;
    this.scene.add(directionalLight);

    const gridHelper = new THREE.GridHelper(200, 50, 0x444444, 0x888888);
    this.scene.add(gridHelper);

    // Create thick custom axes with cylinders
    const axesGroup = new THREE.Group();

    // X-axis (red)
    const xGeometry = new THREE.CylinderGeometry(0.1, 0.1, 5, 8);
    const xMaterial = new THREE.MeshBasicMaterial({ color: 0xff0000 });
    const xAxis = new THREE.Mesh(xGeometry, xMaterial);
    xAxis.rotation.z = -Math.PI / 2;
    xAxis.position.x = 2.5;
    axesGroup.add(xAxis);

    // Y-axis (green)
    const yGeometry = new THREE.CylinderGeometry(0.1, 0.1, 5, 8);
    const yMaterial = new THREE.MeshBasicMaterial({ color: 0x00ff00 });
    const yAxis = new THREE.Mesh(yGeometry, yMaterial);
    yAxis.position.y = 2.5;
    axesGroup.add(yAxis);

    // Z-axis (blue)
    const zGeometry = new THREE.CylinderGeometry(0.1, 0.1, 5, 8);
    const zMaterial = new THREE.MeshBasicMaterial({ color: 0x0000ff });
    const zAxis = new THREE.Mesh(zGeometry, zMaterial);
    zAxis.rotation.x = Math.PI / 2;
    zAxis.position.z = 2.5;
    axesGroup.add(zAxis);

    // this.scene.add(axesGroup); // Hidden for now

    this.meshLoader = new MeshLoader(this.scene);
  }

  setupEventListeners() {
    window.addEventListener("resize", () => {
      this.camera.aspect = window.innerWidth / window.innerHeight;
      this.camera.updateProjectionMatrix();
      this.renderer.setSize(window.innerWidth, window.innerHeight);
      if (this.selector) this.selector.setLineResolution(window.innerWidth, window.innerHeight);
    });

    // Kill iOS OS-level zoom that the viewport meta alone doesn't stop:
    // pinch (gesture* events) and double-tap-to-zoom.
    ["gesturestart", "gesturechange", "gestureend"].forEach((ev) =>
      document.addEventListener(ev, (e) => e.preventDefault(), { passive: false })
    );
    let lastTouchEnd = 0;
    document.addEventListener(
      "touchend",
      (e) => {
        const now = performance.now();
        if (now - lastTouchEnd < 320) e.preventDefault(); // second tap of a double-tap
        lastTouchEnd = now;
      },
      { passive: false }
    );

    this.updateControlsInfo();
    this.selectionCtl.setupSurfaceSelection();
  }

  // Surface selection + paint live in ./app/selection.js (setupSurfaceSelection,
  // handleSurfaceSelection, refreshPending, selectionCenter, pushPendingHistory,
  // undoPending, growPending, shrinkPending, cancelPendingSelection, applyPaint,
  // downscaleTexture, onBrush, brushAccept, pickSurface*, paintCandidates).

  // Review-mode glue (armReviewItem, setReviewAdjusting, quietDisarm,
  // updateReviewSheet, handleReviewConfirm, handleReviewReclass, enterReviewMode,
  // handleReviewExit) lives in ./app/review.js.

  // --- auto-tagging ------------------------------------------------------------

  // Segment + classify the whole map; results become red "flagged" proposals
  // feeding the review queue. Stored labels are the cache — reloads restore
  // them instantly; re-running clears previous auto labels first.
  async runAutoTag() {
    if (!this.labels || !this.selector || this.mode !== "explore" || this.autoTagging) return;
    this.autoTagging = true;
    this.selectionCtl.cancelPendingSelection();
    this.showLoading("Auto-tagging surfaces...");
    const progressText = document.getElementById("loading-progress");
    try {
      const removed = this.labels.removeAuto();
      if (removed) console.log(`auto-tag: cleared ${removed} previous proposals`);
      const t0 = performance.now();
      const res = await autoTag({
        selector: this.selector,
        labels: this.labels,
        root: this.currentMesh,
        onProgress: (done, total, created) => {
          progressText.textContent = `${Math.round((done / total) * 100)}% · ${created} surfaces`;
        },
      });
      console.log(
        `auto-tag: ${res.created} proposals from ${res.regions} regions in ${(
          (performance.now() - t0) / 1000
        ).toFixed(1)}s`
      );
    } catch (err) {
      console.error("auto-tag failed", err);
      alert(`Auto-tag failed: ${err.message}`);
    } finally {
      this.hideLoading();
      this.autoTagging = false;
      this.labelingCtl.renderLabelList();
    }
  }

  // enterReviewMode / handleReviewExit live in ./app/review.js.
  // Chrome (setIntent, setTool, focusSelection, tool-bar sync/wiring, mode
  // toggle) lives in ./app/chrome.js.
  // Labeling UI (initLabelUI, pickers, showLabelPanel, saveLabel,
  // renderLabelList) lives in ./app/labeling.js.

  updateControlsInfo() {
    const infoDiv = document.getElementById("info");
    const isTouchDevice =
      "ontouchstart" in window ||
      navigator.maxTouchPoints > 0 ||
      navigator.msMaxTouchPoints > 0;

    if (isTouchDevice) {
      infoDiv.innerHTML = `
        <strong>Controls</strong><br>
        1 finger — orbit / look<br>
        2 fingers — pinch to zoom, drag to pan<br>
        Pick a tool below to tag. <b>Move</b> = camera only.
      `;
    } else {
      infoDiv.innerHTML = `
        <strong>Desktop Controls:</strong><br>
        WASD - Move<br>
        Shift - Fast mode<br>
        Click + Drag - Look around<br>
        Click - Select surface · Shift+Click - Add · Esc - Cancel
      `;
    }
    infoDiv.innerHTML += `<br><span style="opacity:0.6;font-size:11px">build ${BUILD_VERSION}</span>`;
  }

  // Mesh loading + setup (showLoading/hideLoading/updateLoadingProgress,
  // disposeObject, loadMeshFiles, startLoading, loadRawHighRes,
  // loadProgressiveMesh, setupMesh) live in ./app/loading.js.

  animate() {
    requestAnimationFrame(() => this.animate());

    // Frame-time telemetry for the ?debug HUD — measure BEFORE any work so
    // stalls anywhere in the app show up, not just in this loop.
    if (this.debugLOD) {
      const now = performance.now();
      if (this._lastFrameT != null) {
        const dt = now - this._lastFrameT;
        this._frameEMA = this._frameEMA == null ? dt : this._frameEMA * 0.9 + dt * 0.1;
        if (dt > (this._frameWorst || 0)) this._frameWorst = dt;
        this._frameWorstNow = dt; // this specific frame, for spike forensics
      }
      this._lastFrameT = now;
    }

    if (this.mode === "review" && this.review) {
      this.review.updateFrame(); // tween + orbit damping
    } else {
      this.controls.update();
    }

    // Camera speed (units/sec, smoothed) feeds the streamer's motion gate so
    // texture work never lands during a fly-through.
    if (this.streamer) {
      const nowM = performance.now();
      this._camPos = this._camPos || this.camera.position.clone();
      if (this._camT) {
        const dt = (nowM - this._camT) / 1000;
        if (dt > 0) {
          const inst = this.camera.position.distanceTo(this._camPos) / dt;
          this._camSpeed = (this._camSpeed || 0) * 0.7 + inst * 0.3;
          this.streamer.setMotion(this._camSpeed);
        }
      }
      this._camPos.copy(this.camera.position);
      this._camT = nowM;
    }

    // Don't try to render on a lost context - it just spams GL errors until
    // (and if) the browser restores it.
    if (this.contextLost) return;

    // Re-evaluate which tiles stream a high-res texture periodically (not every
    // frame - it sorts all tiles) so detail follows the camera within budget.
    // Uploads drain one-per-frame so they never stack up into a hitch.
    this.frameCount++;
    if (this.streamer) {
      this.streamer.drainUploads();
      if (this.frameCount % LOD_UPDATE_INTERVAL === 0) {
        this.streamer.update();
        if (this.debugLOD) this.updateLODDebug();
        if (this.debugViz) {
          this.updateVizTint();
          this.updateVizRings();
        }
      }
    }

    // Long-frame forensics: correlate every spike with streamer activity so
    // "LOD tanks my fps" is verifiable frame by frame.
    if (this.debugLOD && this._frameWorstNow > 33) {
      const s = this.streamer;
      console.log(
        `[perf] ${this._frameWorstNow.toFixed(0)}ms frame · ` +
          (s
            ? `lastUpload=tile ${s.lastUploadTile ?? "none"}@${s.lastUploadSize ?? "-"} ` +
              `${s.lastUploadAt ? Math.round(performance.now() - s.lastUploadAt) + "ms ago" : ""} · ` +
              `decoding=${s.decoding} queued=${s.uploadQueue.length}`
            : "no streamer")
      );
      this._frameWorstNow = 0;
    }

    this.renderer.render(this.scene, this.camera);
  }
}

// Compose topical method groups onto the prototype. Each mixin's methods run
// with the app instance as `this`; grouping keeps main.js navigable while the
// single runtime context is preserved (see ./app/*).
Object.assign(
  MeshExplorer.prototype,
  hudMixin,
  loadingMixin,
  inspectMixin,
);

new MeshExplorer();
