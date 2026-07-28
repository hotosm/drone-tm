import * as THREE from "three";
import { SurfaceSelector } from "../SurfaceSelector.js";
import { LabelManager } from "../Labels.js";
import { HighResStreamer } from "../HighResStreamer.js";
import { buildBoundsTrees, disposeBoundsTrees } from "./bvh.js";

// Mesh acquisition + setup: the loading overlay, source selection (local vs
// CDN), the three load paths (drag-drop files, ground-truth raw high-res,
// progressive low-res + streamed high-res), and mesh normalisation. Mixed onto
// MeshExplorer.prototype (`this` is the app). This is also the natural seam for
// a future config-driven mesh-input contract.
export const loadingMixin = {
  showLoading(text = "Loading mesh...") {
    const overlay = document.getElementById("loading-overlay");
    const loadingText = document.getElementById("loading-text");
    const progressText = document.getElementById("loading-progress");

    overlay.classList.add("active");
    loadingText.textContent = text;
    progressText.textContent = "";
  },

  hideLoading() {
    const overlay = document.getElementById("loading-overlay");
    overlay.classList.remove("active");
  },

  updateLoadingProgress(progress) {
    const progressText = document.getElementById("loading-progress");
    if (progress && progress.total > 0) {
      const percent = Math.round((progress.loaded / progress.total) * 100);
      progressText.textContent = `${percent}%`;
    }
  },

  // Free GPU resources (geometries, materials, textures) held by an object
  // tree. Three.js does NOT do this when you remove an object from the scene,
  // so without it every mesh swap leaks GPU memory until the WebGL context is
  // lost (blank screen / mobile tab reload).
  disposeObject(obj) {
    if (!obj) return;
    disposeBoundsTrees(obj); // free BVH memory before the geometry goes
    obj.traverse((child) => {
      if (!child.isMesh) return;
      if (child.geometry) child.geometry.dispose();
      const materials = Array.isArray(child.material)
        ? child.material
        : [child.material];
      materials.forEach((material) => {
        if (!material) return;
        for (const key in material) {
          const value = material[key];
          if (value && value.isTexture) value.dispose();
        }
        material.dispose();
      });
    });
  },

  async loadMeshFiles(files) {
    const startTime = performance.now();
    let lastTime = startTime;

    const logTiming = (label) => {
      const now = performance.now();
      const delta = now - lastTime;
      const total = now - startTime;
      console.log(
        `[TIMING] ${label}: ${delta.toFixed(0)}ms (total: ${total.toFixed(
          0
        )}ms)`
      );
      lastTime = now;
    };

    try {
      this.showLoading("Loading mesh file...");

      if (this.currentMesh) {
        this.scene.remove(this.currentMesh);
        this.disposeObject(this.currentMesh);
        this.currentMesh = null;
      }
      logTiming("Scene cleanup");

      // Check if it's a single GLB/GLTF file
      const filesArray = Array.from(files);
      console.log(
        "Loading files:",
        filesArray.map((f) => f.name)
      );

      const glbFile = filesArray.find(
        (f) => f.name.endsWith(".glb") || f.name.endsWith(".gltf")
      );

      // Use setTimeout to allow UI to update before heavy processing
      await new Promise((resolve) => setTimeout(resolve, 10));
      logTiming("UI update delay");

      if (glbFile) {
        console.log("Loading GLB file:", glbFile.name);
        this.currentMesh = await this.meshLoader.loadFile(
          glbFile,
          (progress) => {
            this.updateLoadingProgress(progress);
          }
        );
      } else {
        // Handle multiple files (OBJ + MTL + textures)
        console.log("Loading multiple files");
        this.currentMesh = await this.meshLoader.loadFiles(filesArray);
      }
      logTiming("File loaded and parsed");

      console.log("Mesh loaded successfully:", this.currentMesh);

      this.showLoading("Processing geometry...");

      // Calculate bounds BEFORE adding to scene
      const box = new THREE.Box3().setFromObject(this.currentMesh);
      logTiming("Bounding box calculation");

      const center = box.getCenter(new THREE.Vector3());
      const size = box.getSize(new THREE.Vector3());

      console.log("Mesh size:", size);

      const maxDim = Math.max(size.x, size.y, size.z);
      const scale = 50 / maxDim;
      this.currentMesh.scale.multiplyScalar(scale);

      this.currentMesh.position.sub(center.multiplyScalar(scale));
      this.currentMesh.position.y = 0;
      logTiming("Scaling and positioning");

      // Optimize materials for large meshes
      let meshCount = 0;
      let materialCount = 0;
      this.currentMesh.traverse((child) => {
        if (child instanceof THREE.Mesh) {
          meshCount++;
          // Enable frustum culling
          child.frustumCulled = true;

          // Optimize material settings
          if (child.material) {
            materialCount++;
            child.material.precision = "mediump";
          }
        }
      });
      console.log(
        `Processed ${meshCount} meshes with ${materialCount} materials`
      );
      logTiming("Material optimization");

      this.camera.position.set(0, size.y * scale * 0.5, size.z * scale * 1.5);
      this.controls.reset();
      logTiming("Camera setup");

      // Now add to scene after all processing is done
      this.showLoading("Adding to scene...");
      await new Promise((resolve) => setTimeout(resolve, 10));
      this.scene.add(this.currentMesh);
      logTiming("Added to scene");

      // Force a render to upload to GPU
      this.showLoading("Uploading to GPU...");
      await new Promise((resolve) => setTimeout(resolve, 10));
      this.renderer.render(this.scene, this.camera);
      logTiming("First render (GPU upload)");

      this.hideLoading();
      logTiming("Complete");
    } catch (error) {
      this.hideLoading();
      console.error("Detailed error loading mesh:", error);
      console.error("Error stack:", error.stack);
      alert(`Failed to load mesh file: ${error.message}`);
    }
  },

  // Pick mesh sources (local copies auto-detected, else CDN) and dispatch to
  // the requested mode. No ?local needed on dev machines with the files.
  async startLoading(params) {
    let useLocal = params.has("local");
    if (!useLocal) {
      try {
        const probe = await fetch("/resources/models/coconut-low.glb", { method: "HEAD" });
        useLocal = probe.ok;
      } catch (e) {
        /* CDN it is */
      }
    }
    const lowUrl = useLocal
      ? "/resources/models/coconut-low.glb"
      : "https://9cw9jnmyps.ufs.sh/f/lmDN3zvaRWNx0lqYJJ2zb6Xow4apUyGg09cPEkSDjMLBJKHq";
    const highUrl = useLocal
      ? "/resources/models/coconut-high.glb"
      : "https://9cw9jnmyps.ufs.sh/f/lmDN3zvaRWNxioLwD1Ldeg4T8dxVEobRa6BzCGisrcLNPtOl";
    console.log(`[drone-mesh] source: ${useLocal ? "local files" : "CDN"}`);

    if (params.has("full")) {
      // GROUND-TRUTH MODE: no streamer, no texture stripping, no decode
      // pipeline. GLTFLoader ingests the full high-res GLB with textures —
      // the identical path Blender uses. This is, by definition, the maximum
      // quality this file contains. Desktop-class memory required (~2.9 GB).
      this.loadRawHighRes(highUrl);
    } else {
      this.loadProgressiveMesh(lowUrl, highUrl);
    }
  },

  async loadRawHighRes(url) {
    try {
      this.showLoading("Loading FULL model (ground-truth mode)…");
      const mesh = await this.meshLoader.loadFromUrl(url, (p) =>
        this.updateLoadingProgress(p)
      );
      await this.setupMesh(mesh);
      this.hideLoading();
      console.log(
        "[drone-mesh] RAW mode: full GLB with native textures, no streaming pipeline"
      );

      // Selection/labeling still work, but against the raw mesh's own face
      // indexing — keep its labels in a separate storage bucket so they can't
      // corrupt the canonical (progressive-mode) label set.
      this.selector = new SurfaceSelector(this.scene);
      this.labels = new LabelManager({
        scene: this.scene,
        root: this.currentMesh,
        mapKey: `${url}#raw`,
      });
      this.labels.restore();
      this.chrome.showToolbar(true);
      this.labelingCtl.renderLabelList();
    } catch (err) {
      this.hideLoading();
      console.error("raw load failed", err);
      alert(`Failed to load full model: ${err.message}`);
    }
  },

  async loadProgressiveMesh(lowResUrl, highResUrl) {
    try {
      // Load low-res version first
      this.showLoading("Loading preview...");
      console.log("Loading low-res mesh...");

      this.lowResMesh = await this.meshLoader.loadFromUrl(
        lowResUrl,
        (progress) => {
          this.updateLoadingProgress(progress);
        },
        (status) => {
          // Surface cache state on-screen (dev diagnostic): "cache: HIT …" on a
          // cached reload, "miss → downloading" / "unavailable (blocked?)" else.
          const el = document.getElementById("loading-text");
          if (el) el.textContent = `Loading preview · cache: ${status}`;
        }
      );

      await this.setupMesh(this.lowResMesh);
      this.hideLoading();
      console.log("Low-res mesh loaded and displayed");

      // Selection + labels operate on the low-res mesh (stable geometry —
      // high-res streaming only swaps textures/visibility, so face indices
      // stay valid for stored labels).
      this.selector = new SurfaceSelector(this.scene);
      this.labels = new LabelManager({
        scene: this.scene,
        root: this.currentMesh,
        mapKey: lowResUrl,
      });
      const restored = this.labels.restore();
      if (restored) console.log(`Restored ${restored} saved labels`);
      this.chrome.showToolbar(true);
      this.labelingCtl.renderLabelList();

      // NO automatic pre-warm: the adjacency build (incl. one long synchronous
      // global-graph merge) was stealing frames right after load, while users
      // fly. First selection click pays it instead — user is stationary then.

      // Stream high-res textures by proximity. The 61 MB high-res GLB is fetched
      // once and stripped of its textures so nothing is decoded up front; only
      // the nearest tiles ever decode/upload a texture. This is what keeps memory
      // bounded on tablets/phones (see HighResStreamer).
      this.isLoadingHighRes = true;

      console.log("Starting high-res streaming...");
      this.streamer = new HighResStreamer({
        scene: this.scene,
        camera: this.camera,
        renderer: this.renderer,
        gltfLoader: this.meshLoader.loaders.gltf,
        nativeSize: this.streamProfile.nativeSize,
        ringSize: this.streamProfile.ringSize,
        nativeCap: this.streamProfile.nativeCap,
        totalCap: this.streamProfile.totalCap,
        keepDist: this.streamProfile.keepDist,
        maxAnisotropy: Math.min(8, this.renderer.capabilities.getMaxAnisotropy()),
      });
      const tileCount = await this.streamer.load(highResUrl, this.currentMesh);
      console.log(`High-res streaming active: ${tileCount} tiles`);

      // If review mode started before the high-res GLB arrived, hand it the
      // streamer and point the texture focus at the current item.
      if (this.review) {
        this.review.streamer = this.streamer;
        const item = this.review.cur();
        if (this.review.active && item) this.review.applyFocus(item);
      }

      // Textures now stream continuously by proximity/frustum (see the animate
      // loop + HighResStreamer). The opening view sharpens the same silent way a
      // fly-through does — no separate warmup indicator.
      this.isLoadingHighRes = false;
    } catch (error) {
      this.hideLoading();
      console.error("Error loading progressive mesh:", error);
      alert(`Failed to load mesh: ${error.message}`);
    }
  },

  // Downscale a texture's backing image in place (base-layer memory trim).
  // No-op if already small or the image can't be drawn.
  downscaleTexture(tex, maxSize) {
    if (!tex || !tex.image) return;
    const img = tex.image;
    const w = img.width || img.videoWidth || 0;
    const h = img.height || img.videoHeight || 0;
    if (!w || !h || Math.max(w, h) <= maxSize) return;
    try {
      const s = maxSize / Math.max(w, h);
      const canvas = document.createElement("canvas");
      canvas.width = Math.max(1, Math.round(w * s));
      canvas.height = Math.max(1, Math.round(h * s));
      canvas.getContext("2d").drawImage(img, 0, 0, canvas.width, canvas.height);
      tex.image = canvas;
      tex.needsUpdate = true;
      if (typeof img.close === "function") {
        try { img.close(); } catch (e) { /* ignore */ }
      }
    } catch (e) {
      /* CORS-tainted or unsupported — leave as-is */
    }
  },

  async setupMesh(mesh) {
    const startTime = performance.now();
    let lastTime = startTime;

    const logTiming = (label) => {
      const now = performance.now();
      const delta = now - lastTime;
      const total = now - startTime;
      console.log(
        `[TIMING] ${label}: ${delta.toFixed(0)}ms (total: ${total.toFixed(
          0
        )}ms)`
      );
      lastTime = now;
    };

    if (this.currentMesh && this.currentMesh !== mesh) {
      this.scene.remove(this.currentMesh);
      this.disposeObject(this.currentMesh);
    }

    // Calculate bounds BEFORE adding to scene
    const box = new THREE.Box3().setFromObject(mesh);
    logTiming("Bounding box calculation");

    const center = box.getCenter(new THREE.Vector3());
    const size = box.getSize(new THREE.Vector3());

    console.log("Mesh size:", size);

    // Fix mesh orientation - rotate in world coordinates
    mesh.rotation.order = "YXZ"; // Apply Y rotation first, then X
    mesh.rotation.y = Math.PI; // 180 degrees around world Y-axis first
    mesh.rotation.x = -Math.PI / 2; // Then 90 degrees around X-axis
    logTiming("Mesh rotation fix");

    const maxDim = Math.max(size.x, size.y, size.z);
    const scale = 50 / maxDim;
    mesh.scale.multiplyScalar(scale);

    mesh.position.sub(center.multiplyScalar(scale));
    mesh.position.y = 0;
    logTiming("Scaling and positioning");

    // Optimize materials for large meshes. On touch, downscale the ALWAYS-
    // resident base textures (130 tiles) — at 512² they're ~180 MB, the
    // single biggest static memory cost and a prime cause of the iOS
    // tab-kill. 256² cuts that ~4× and detail near the camera still comes
    // from the high-res streamer.
    const touch = "ontouchstart" in window || navigator.maxTouchPoints > 0;
    const baseCap = touch ? 256 : 1024;
    let meshCount = 0;
    let materialCount = 0;
    mesh.traverse((child) => {
      if (child instanceof THREE.Mesh) {
        meshCount++;
        child.frustumCulled = true;
        child.castShadow = false;
        child.receiveShadow = false;

        if (child.material) {
          materialCount++;
          child.material.precision = "mediump";
          this.downscaleTexture(child.material.map, baseCap);
        }
      }
    });
    console.log(
      `Processed ${meshCount} meshes with ${materialCount} materials`
    );
    logTiming("Material optimization");

    // Set camera position only for first mesh - up and back from origin
    if (!this.currentMesh) {
      this.camera.position.set(0, 10, 15); // Up and back from origin
      this.controls.reset();
      this.controls.lat = -15; // Look down slightly
      this.controls.lon = -90; // Rotate to look along Z-axis
    }
    logTiming("Camera setup");

    // Add to scene
    this.scene.add(mesh);
    this.currentMesh = mesh;
    if (this.controls) this.controls.collider = mesh; // nav collision target
    // Accelerate all raycasts against this mesh (collision, select, brush,
    // lasso). Index-preserving so saved face indices stay valid.
    buildBoundsTrees(mesh);
    logTiming("BVH build");
    logTiming("Added to scene");

    // Force render
    this.renderer.render(this.scene, this.camera);
    logTiming("First render (GPU upload)");

    return mesh;
  },
};
