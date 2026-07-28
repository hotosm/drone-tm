// Headless controller-test harness. The MeshExplorer glue lives in mixins that
// run against an app instance touching the real DOM (index.html) — it can't be
// exercised by the plain-geometry suites. Here we load index.html into jsdom
// and build a FAKE app: real SurfaceSelector + LabelManager over a small
// BufferGeometry fixture, stubbed renderer/camera/controls, and the real
// mixins Object.assign'd on. That drives the actual glue without WebGL.
import { readFileSync } from "node:fs";
import { JSDOM } from "jsdom";
import * as THREE from "three";
import { SurfaceSelector } from "../src/SurfaceSelector.js";
import { LabelManager } from "../src/Labels.js";
import { ChromeController } from "../src/app/ChromeController.js";
import { LabelingController } from "../src/app/LabelingController.js";
import { SelectionController } from "../src/app/SelectionController.js";
import { ReviewController } from "../src/app/ReviewController.js";
import { inspectMixin } from "../src/app/inspect.js";

// --- jsdom globals (installed once at import) ------------------------------
const html = readFileSync(new URL("../index.html", import.meta.url), "utf8");
const dom = new JSDOM(html, { url: "http://localhost/", pretendToBeVisual: true });
globalThis.window = dom.window;
globalThis.document = dom.window.document;
globalThis.localStorage = dom.window.localStorage;
globalThis.alert = () => {};
globalThis.confirm = () => true;
if (!globalThis.requestIdleCallback) globalThis.requestIdleCallback = (fn) => setTimeout(fn, 0);

export { THREE };

export const assert = (cond, msg) => {
  if (!cond) {
    console.error(`FAIL: ${msg}`);
    process.exit(1);
  }
  console.log(`ok: ${msg}`);
};

// One flat quad (two triangles), +Y normal — classifies roof-flat.
function makeQuad() {
  const geom = new THREE.BufferGeometry();
  geom.setAttribute(
    "position",
    new THREE.Float32BufferAttribute([0, 0, 0, 1, 0, 0, 1, 0, 1, 0, 0, 1], 3)
  );
  geom.setIndex([0, 2, 1, 0, 3, 2]);
  return new THREE.Mesh(geom, new THREE.MeshBasicMaterial());
}

// Build a fresh fake app. Each call gets an isolated localStorage map key so
// LabelManager state never bleeds between tests.
let seq = 0;
export function makeApp({ mode = "explore", editTool = "tap" } = {}) {
  document.body.classList.remove("review-mode", "adjusting");

  const mesh = makeQuad();
  const root = new THREE.Group();
  root.add(mesh);
  const scene = new THREE.Scene();
  scene.add(root);
  root.updateMatrixWorld(true);

  const domEl = document.createElement("canvas");
  domEl.getBoundingClientRect = () => ({ left: 0, top: 0, width: 800, height: 600 });
  Object.defineProperty(domEl, "clientWidth", { value: 800, configurable: true });
  Object.defineProperty(domEl, "clientHeight", { value: 600, configurable: true });
  domEl.setPointerCapture = () => {};
  domEl.releasePointerCapture = () => {};

  const renderer = {
    domElement: domEl,
    render() {},
    setSize() {},
    setPixelRatio() {},
    capabilities: { getMaxAnisotropy: () => 8 },
  };
  const controls = {
    enabled: true,
    paintMode: false,
    orbitTarget: null,
    syncFromCamera() {},
    reset() {},
    update() {},
    lat: 0,
    lon: 0,
  };
  const camera = new THREE.PerspectiveCamera(75, 800 / 600, 0.3, 1200);
  camera.position.set(0, 5, 10);
  camera.updateMatrixWorld(true);

  const selector = new SurfaceSelector(scene);
  const labels = new LabelManager({ scene, root, mapKey: `dmt-test:${seq++}` });

  const app = Object.assign(
    {
      scene,
      camera,
      renderer,
      controls,
      orbit: null,
      currentMesh: root,
      selector,
      labels,
      raycaster: new THREE.Raycaster(),
      mouse: new THREE.Vector2(),
      pending: null,
      mode,
      pendingHistory: [],
      editingLabelId: null,
      review: null,
      streamer: null,
      debugLOD: false,
      debugViz: false,
      // Explore classifier inspector state (see src/app/inspect.js), mirroring
      // main.js so controllers can call app.updateInspector() as they do live.
      inspectMode: true,
      terrain: null,
    },
    inspectMixin,
  );

  // Chrome is a controller (owns tool/intent), not a mixin — create before the
  // UI wiring, which calls this.chrome.setupToolbar().
  app.chrome = new ChromeController(app);
  app.chrome.editTool = editTool;
  app.reviewCtl = new ReviewController(app);
  app.labelingCtl = new LabelingController(app);
  app.selectionCtl = new SelectionController(app);

  // Real UI wiring (creates app.ui + app.paint via PaintTools, binds the bar).
  app.labelingCtl.initLabelUI();
  return { app, root, mesh, scene, selector, labels };
}

// A selected-face Map for the whole fixture quad.
export function wholeQuad(mesh) {
  return new Map([[mesh, new Set([0, 1])]]);
}
