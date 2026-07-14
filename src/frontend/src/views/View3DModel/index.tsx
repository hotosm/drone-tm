import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { TilesRenderer } from "3d-tiles-renderer";
import { LoadRegionPlugin, SphereRegion, TilesFadePlugin } from "3d-tiles-renderer/three/plugins";
import centroid from "@turf/centroid";
import { useGetProjectsDetailQuery } from "@Api/projects";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import { m } from "@/paraglide/messages";

// DRACO/KTX2 decoder assets are copied into public/three-libs/ at build time.
// Self-hosted so the viewer doesn't break if a third-party CDN goes down.
const DRACO_DECODER_PATH = "/three-libs/draco/";
const KTX2_TRANSCODER_PATH = "/three-libs/basis/";

const MAX_TILE_ERRORS_BEFORE_FAIL = 25;
const TILE_ERROR_TARGET = 10;
const TILE_MAX_TILES_PROCESSED = 350;
// LoadRegionPlugin effective error = tile.geometricError - region.errorTarget
// + renderer.errorTarget. Higher = coarser halo over the whole model; camera
// frustum still drives full-resolution refinement nearby.
const TILE_REGION_ERROR_TARGET = 24;
const TILE_REGION_RADIUS_MULTIPLIER = 1.35;
// LRU defaults target Cesium-style tilesets; multi-GB photogrammetry trees
// evict useful tiles on pan without this headroom.
const TILE_LRU_MIN_SIZE = 3500;
const TILE_LRU_MAX_SIZE = 6000;
const TILE_LRU_MIN_BYTES = 512 * 1024 * 1024;
const TILE_LRU_MAX_BYTES = 1024 * 1024 * 1024;
const TILE_DOWNLOAD_CONCURRENCY = 32;
const TILE_PARSE_CONCURRENCY = 8;
const TILE_FADE_DURATION_MS = 180;
const TILE_FADE_OUT_LIMIT = 250;
const EMPTY_PARENT_MIN_GEOMETRIC_ERROR = TILE_REGION_ERROR_TARGET + 1;

type ModelState = "idle" | "loading" | "loaded" | "error" | "unavailable";

type ProjectData = {
  name?: string;
  outline?: GeoJSON.Feature | GeoJSON.FeatureCollection;
  cloud_mesh_tileset_url?: string | null;
};

function matrixFromArray(matrix: Iterable<number>): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(Array.from(matrix));
}

function forceRendererContentZUp(tiles: TilesRenderer) {
  // eslint-disable-next-line no-underscore-dangle
  const internal = tiles as unknown as { _upRotationMatrix?: THREE.Matrix4 };
  // eslint-disable-next-line no-underscore-dangle
  internal._upRotationMatrix?.identity();
}

function configureTilesRendererForPhotogrammetry(tiles: TilesRenderer) {
  const r = tiles;
  r.errorTarget = TILE_ERROR_TARGET;
  r.maxTilesProcessed = TILE_MAX_TILES_PROCESSED;
  r.optimizedLoadStrategy = true;
  r.loadSiblings = true;
  // Render loaded tiles even when outside the render camera's frustum so the
  // LoadRegionPlugin halo stays visible during panning.
  r.displayActiveTiles = true;
  r.lruCache.minSize = TILE_LRU_MIN_SIZE;
  r.lruCache.maxSize = TILE_LRU_MAX_SIZE;
  r.lruCache.minBytesSize = TILE_LRU_MIN_BYTES;
  r.lruCache.maxBytesSize = TILE_LRU_MAX_BYTES;
  r.downloadQueue.maxJobs = TILE_DOWNLOAD_CONCURRENCY;
  r.parseQueue.maxJobs = TILE_PARSE_CONCURRENCY;
}

// ODM-produced tilesets sometimes violate the 3D Tiles invariant that a
// parent tile's geometricError >= each child's. The renderer only refines
// while geometricError > errorTarget, so a parent reported as 0 (or less
// than a child) blocks refinement and whole branches never load.
function repairTilesetGeometricErrors(root: unknown) {
  function visit(tile: unknown): number | null {
    const record = tile as Record<string, any> | null;
    if (!record) return null;

    const children = Array.isArray(record.children) ? record.children : [];
    const hasRenderableContent = !!record.content || !!record.contents;
    const childRenderableErrors = children
      .map(visit)
      .filter((value: number | null): value is number => value !== null);
    const maxRenderableChild = childRenderableErrors.length
      ? Math.max(...childRenderableErrors)
      : null;
    const original = typeof record.geometricError === "number" ? record.geometricError : null;

    if (!hasRenderableContent) {
      if (maxRenderableChild === null) return null;
      const adjusted = Math.max(maxRenderableChild * 1.01, EMPTY_PARENT_MIN_GEOMETRIC_ERROR);
      if (original === null || original < adjusted) {
        record.geometricError = Number(adjusted.toFixed(6));
      }
      return record.geometricError as number;
    }

    if (original === null) {
      const adjusted = maxRenderableChild === null ? 0 : maxRenderableChild * 1.01;
      record.geometricError = Number(adjusted.toFixed(6));
      return record.geometricError as number;
    }

    if (maxRenderableChild !== null && original < maxRenderableChild) {
      record.geometricError = Number((maxRenderableChild * 1.01).toFixed(6));
    }

    return record.geometricError as number;
  }

  visit(root);
}

// 3D Tiles store geometry in ECEF; convert the bounding-sphere centre to
// geographic so we can place the Mercator transform.
function ecefToLngLatAlt(x: number, y: number, z: number) {
  const a = 6378137.0;
  const e2 = 6.69437999014e-3;
  const b = a * Math.sqrt(1 - e2);
  const ep2 = (a * a - b * b) / (b * b);
  const p = Math.sqrt(x * x + y * y);
  const th = Math.atan2(a * z, b * p);
  const lon = Math.atan2(y, x);
  const lat = Math.atan2(z + ep2 * b * Math.sin(th) ** 3, p - e2 * a * Math.cos(th) ** 3);
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
  const alt = p / Math.cos(lat) - n;
  return { lng: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI, alt };
}

// Which local axis of the tileset's root transform is vertical at this site?
// ODM/Obj2Tiles emits Z-up B3DM but the renderer applies a default Y-up glTF
// correction; if the root transform says Z is vertical we have to skip it.
function inferTilesetLocalUpAxis(
  transform: unknown,
  lng: number,
  lat: number,
): "x" | "y" | "z" | null {
  if (
    !Array.isArray(transform) ||
    transform.length !== 16 ||
    transform.some((value) => typeof value !== "number")
  ) {
    return null;
  }
  const lngRad = (lng * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const up = new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lngRad),
    Math.cos(latRad) * Math.sin(lngRad),
    Math.sin(latRad),
  );
  const xDot = Math.abs(
    new THREE.Vector3(transform[0], transform[1], transform[2]).normalize().dot(up),
  );
  const yDot = Math.abs(
    new THREE.Vector3(transform[4], transform[5], transform[6]).normalize().dot(up),
  );
  const zDot = Math.abs(
    new THREE.Vector3(transform[8], transform[9], transform[10]).normalize().dot(up),
  );
  if (zDot >= xDot && zDot >= yDot) return "z";
  if (yDot >= xDot) return "y";
  return "x";
}

const View3DModel = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Set when the tileset finishes loading; used by the re-centre button.
  const modelLocationRef = useRef<{ lng: number; lat: number } | null>(null);
  const [modelState, setModelState] = useState<ModelState>("idle");

  const handleRecenter = useCallback(() => {
    if (!mapRef.current || !modelLocationRef.current) return;
    mapRef.current.flyTo({
      center: [modelLocationRef.current.lng, modelLocationRef.current.lat],
      zoom: 18,
      pitch: 60,
      bearing: 0,
    });
  }, []);

  const { data, isFetching } = useGetProjectsDetailQuery(id as string);
  const projectData = data as ProjectData | undefined;
  const tilesetUrl = projectData?.cloud_mesh_tileset_url ?? null;
  // RTK Query returns a new projectData reference on every refetch (e.g. on
  // window focus). Read `outline` via a ref so the effect doesn't tear down
  // the WebGL scene on each refetch.
  const outlineRef = useRef<ProjectData["outline"]>(undefined);
  outlineRef.current = projectData?.outline;

  useEffect(() => {
    if (!mapContainerRef.current || isFetching) return undefined;
    if (mapRef.current) return undefined;

    if (!tilesetUrl) {
      setModelState("unavailable");
      return undefined;
    }

    const projectCentroid = outlineRef.current
      ? (centroid(outlineRef.current as any).geometry.coordinates as [number, number])
      : [0, 0];
    const [initLng, initLat] = projectCentroid;

    const map = new maplibregl.Map({
      container: mapContainerRef.current,
      style: "https://tiles.openfreemap.org/styles/bright",
      zoom: 14,
      center: [initLng, initLat],
      pitch: 60,
      maxPitch: 80,
      antialias: true,
    });
    mapRef.current = map;

    let camera: THREE.PerspectiveCamera | null = null;
    let scene: THREE.Scene | null = null;
    let renderer: THREE.WebGLRenderer | null = null;
    let tilesCamera: THREE.PerspectiveCamera | null = null;
    let tiles: TilesRenderer | null = null;
    let regionPlugin: LoadRegionPlugin | null = null;
    let fadePlugin: TilesFadePlugin | null = null;
    let dracoLoader: DRACOLoader | null = null;
    let ktx2Loader: KTX2Loader | null = null;
    let localTransform: THREE.Matrix4 | null = null;
    let resizeObserver: ResizeObserver | null = null;
    let resizeFrame: number | null = null;
    let cancelled = false;
    let tileErrorCount = 0;

    function triggerRepaint() {
      if (!cancelled) map.triggerRepaint();
    }

    function updateTileResolution() {
      if (tiles && tilesCamera && renderer) {
        tiles.setResolutionFromRenderer(tilesCamera, renderer);
      }
    }

    function scheduleMapResize() {
      if (resizeFrame !== null) return;
      resizeFrame = window.requestAnimationFrame(() => {
        resizeFrame = null;
        if (cancelled) return;
        map.resize();
        updateTileResolution();
        triggerRepaint();
      });
    }

    function buildLocalTransform(lng: number, lat: number, alt: number): THREE.Matrix4 {
      const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], alt);
      const scale = mc.meterInMercatorCoordinateUnits();
      const rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      return new THREE.Matrix4()
        .makeTranslation(mc.x, mc.y, mc.z ?? 0)
        .scale(new THREE.Vector3(scale, -scale, scale))
        .multiply(rotX);
    }

    const handleMapResize = () => {
      updateTileResolution();
      triggerRepaint();
    };
    map.on("load", scheduleMapResize);
    map.on("resize", handleMapResize);
    if (typeof ResizeObserver !== "undefined") {
      resizeObserver = new ResizeObserver(scheduleMapResize);
      resizeObserver.observe(mapContainerRef.current);
    }
    scheduleMapResize();

    function initTiles(
      url: string,
      sceneInst: THREE.Scene,
      cameraInst: THREE.PerspectiveCamera,
      rendererInst: THREE.WebGLRenderer,
    ) {
      const gltfLoader = new GLTFLoader();

      dracoLoader = new DRACOLoader();
      dracoLoader.setDecoderPath(DRACO_DECODER_PATH);
      gltfLoader.setDRACOLoader(dracoLoader);

      ktx2Loader = new KTX2Loader();
      ktx2Loader.setTranscoderPath(KTX2_TRANSCODER_PATH);
      ktx2Loader.detectSupport(rendererInst);
      gltfLoader.setKTX2Loader(ktx2Loader);

      tiles = new TilesRenderer(url);
      tiles.group.name = "tiles";
      configureTilesRendererForPhotogrammetry(tiles);
      fadePlugin = new TilesFadePlugin({
        fadeDuration: TILE_FADE_DURATION_MS,
        fadeRootTiles: false,
        maximumFadeOutTiles: TILE_FADE_OUT_LIMIT,
      });
      tiles.registerPlugin(fadePlugin);
      // LoadRegionPlugin forces a coarse halo over the whole model regardless
      // of camera frustum so zoomed-out views show everything. The actual
      // region is added in load-tileset once the bounding sphere is known.
      regionPlugin = new LoadRegionPlugin();
      tiles.registerPlugin(regionPlugin);
      sceneInst.add(tiles.group);
      tiles.setCamera(cameraInst);
      tiles.setResolutionFromRenderer(cameraInst, rendererInst);
      tiles.manager.addHandler(/\.(gltf|glb)$/g, gltfLoader);

      let handled = false;
      const onLoadTileset = () => {
        if (handled || !tiles) return;
        handled = true;
        tiles.removeEventListener("load-tileset", onLoadTileset);

        const sphere = new THREE.Sphere();
        tiles.getBoundingSphere(sphere);
        const centre = sphere.center.clone();
        const { lng, lat, alt } = ecefToLngLatAlt(centre.x, centre.y, centre.z);
        const { root } = tiles;
        repairTilesetGeometricErrors(root);

        if (cancelled) return;

        // Pad the halo sphere radius so border tiles whose AABBs poke outside
        // the loose bounding sphere still intersect.
        if (regionPlugin) {
          const haloSphere = sphere.clone();
          haloSphere.radius *= TILE_REGION_RADIUS_MULTIPLIER;
          regionPlugin.clearRegions();
          regionPlugin.addRegion(
            new SphereRegion({
              sphere: haloSphere,
              errorTarget: TILE_REGION_ERROR_TARGET,
            }),
          );
        }
        modelLocationRef.current = { lng, lat };
        map.jumpTo({ center: [lng, lat], zoom: 18, pitch: 60 });
        // Any vertical offset between tileset altitude and the map surface is
        // a georeferencing issue in Obj2Tiles input and must be fixed there.
        localTransform = buildLocalTransform(lng, lat, alt);

        let m: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        const rootRecord = root as Record<string, any> | null;
        if (rootRecord && Array.isArray(rootRecord.transform)) {
          m = rootRecord.transform as number[];
        }
        const rotMat3 = new THREE.Matrix3().set(
          m[0],
          m[1],
          m[2],
          m[8],
          m[9],
          m[10],
          -m[4],
          -m[5],
          -m[6],
        );
        const finalMatrix = new THREE.Matrix4()
          .setFromMatrix3(rotMat3)
          .multiply(new THREE.Matrix4().makeTranslation(-centre.x, -centre.y, -centre.z));

        tiles.group.matrix.copy(finalMatrix);
        tiles.group.matrixAutoUpdate = false;
        tiles.group.updateMatrixWorld(true);

        const declaredGltfUpAxis =
          typeof rootRecord?.asset?.gltfUpAxis === "string"
            ? (rootRecord.asset.gltfUpAxis as string).toLowerCase()
            : null;
        const inferredUpAxis = inferTilesetLocalUpAxis(m, lng, lat);
        // Skip the renderer's default Y-up correction when the root transform
        // says Z is vertical (ODM/Obj2Tiles content) and the tileset doesn't
        // declare otherwise.
        if (inferredUpAxis === "z" && (!declaredGltfUpAxis || declaredGltfUpAxis === "y")) {
          forceRendererContentZUp(tiles);
        }

        // Don't flip to "loaded" here - tileset.json parsing finishing only
        // means metadata is available. Wait for the first load-model so the
        // loading overlay stays up until a mesh is actually visible.
      };
      tiles.addEventListener("load-tileset", onLoadTileset);
      tiles.addEventListener("needs-update", triggerRepaint);
      tiles.addEventListener("needs-render", triggerRepaint);
      tiles.addEventListener("fade-change", triggerRepaint);
      tiles.addEventListener("fade-start", triggerRepaint);
      tiles.addEventListener("fade-end", triggerRepaint);
      tiles.addEventListener("tiles-load-start", triggerRepaint);
      tiles.addEventListener("tiles-load-end", triggerRepaint);
      let firstModelLoaded = false;
      tiles.addEventListener("load-model", () => {
        if (firstModelLoaded || cancelled) return;
        firstModelLoaded = true;
        setModelState("loaded");
      });

      // Seed localTransform with a placeholder so render() will call
      // tiles.update(), which is what actually triggers the tileset.json
      // fetch. onLoadTileset replaces this with the real georeferencing.
      localTransform = buildLocalTransform(0, 0, 0);

      // load-error fires per failed asset. Failing on the tileset itself is
      // fatal; sporadic per-tile failures aren't.
      tiles.addEventListener("load-error", (event: any) => {
        const failedUrl: string | undefined = event?.url;
        const isTileset = !!failedUrl && failedUrl.endsWith("tileset.json");
        if (isTileset) {
          // eslint-disable-next-line no-console
          console.error("Failed to load 3D tileset", event?.error);
          if (!cancelled) setModelState("error");
          return;
        }
        tileErrorCount += 1;
        if (tileErrorCount >= MAX_TILE_ERRORS_BEFORE_FAIL && !firstModelLoaded && !cancelled) {
          // eslint-disable-next-line no-console
          console.error(`Aborting after ${tileErrorCount} tile load errors`);
          setModelState("error");
        }
      });
    }

    const customLayer: CustomLayerInterface = {
      id: "3d-tiles",
      type: "custom",
      renderingMode: "3d",
      onAdd(mapArg, gl) {
        camera = new THREE.PerspectiveCamera();
        scene = new THREE.Scene();
        scene.add(new THREE.AmbientLight(0xffffff, 3));

        renderer = new THREE.WebGLRenderer({
          canvas: mapArg.getCanvas(),
          context: gl as WebGLRenderingContext,
          antialias: true,
        });
        renderer.autoClear = false;

        tilesCamera = new THREE.PerspectiveCamera();
        // Critical: stop Three.js from recomputing matrixWorld from the
        // identity PRS every frame, which would wipe the matrixWorld we copy
        // in from MapLibre and cause 3d-tiles-renderer to cull/select from
        // the wrong viewpoint (visible as holes while panning/zooming).
        tilesCamera.matrixAutoUpdate = false;
        initTiles(tilesetUrl, scene, tilesCamera, renderer);
      },
      // maplibre-gl v4: render(gl, matrix, options). `matrix` is
      // transform.customLayerMatrix(); options.modelViewProjectionMatrix uses
      // MapLibre's internal world-space coordinates and must not be mixed
      // with MercatorCoordinate.fromLngLat output.
      render(_gl, matrix, options: CustomRenderMethodInput) {
        if (!camera || !renderer || !scene || !localTransform || !tilesCamera) return;

        camera.projectionMatrix.fromArray(Array.from(matrix as Iterable<number>));
        camera.projectionMatrix.multiply(localTransform);

        const P = matrixFromArray(options.projectionMatrix as Iterable<number>);
        const V = new THREE.Matrix4().multiplyMatrices(P.clone().invert(), camera.projectionMatrix);

        tilesCamera.projectionMatrix.copy(P);
        // Keep projectionMatrixInverse coherent with projectionMatrix -
        // 3d-tiles-renderer uses both for screen-space error.
        tilesCamera.projectionMatrixInverse.copy(P).invert();
        tilesCamera.matrixWorldInverse.copy(V);
        tilesCamera.matrixWorld.copy(V).invert();
        updateTileResolution();

        // Update tile selection before drawing so the frame uses the latest
        // visible set rather than lagging one frame behind camera motion.
        tiles?.update();
        renderer.resetState();
        renderer.render(scene, camera);
        // No unconditional triggerRepaint here - MapLibre repaints on user
        // interaction and the tiles needs-update/fade handlers schedule
        // repaints for async load completion. Forcing 60fps pins the GPU.
      },
    };

    setModelState("loading");
    if (map.isStyleLoaded()) {
      map.addLayer(customLayer);
    } else {
      map.once("style.load", () => {
        if (!cancelled) map.addLayer(customLayer);
      });
    }

    return () => {
      cancelled = true;
      map.off("load", scheduleMapResize);
      map.off("resize", handleMapResize);
      resizeObserver?.disconnect();
      resizeObserver = null;
      if (resizeFrame !== null) {
        window.cancelAnimationFrame(resizeFrame);
        resizeFrame = null;
      }
      // TilesRenderer.dispose() iterates registered plugins, so fade/region
      // are torn down here too.
      tiles?.dispose();
      tiles = null;
      regionPlugin = null;
      fadePlugin = null;
      ktx2Loader?.dispose();
      dracoLoader?.dispose();
      ktx2Loader = null;
      dracoLoader = null;
      renderer?.dispose();
      renderer = null;
      scene = null;
      camera = null;
      tilesCamera = null;
      localTransform = null;
      modelLocationRef.current = null;
      map.remove();
      mapRef.current = null;
    };
  }, [tilesetUrl, isFetching]);

  const projectName = projectData?.name;

  return (
    <div className="naxatw-relative naxatw-flex naxatw-h-screen naxatw-flex-col">
      <div className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-border-b naxatw-bg-white naxatw-px-6 naxatw-py-3">
        <button
          type="button"
          aria-label={m.viewer_back_to_project()}
          className="material-icons naxatw-cursor-pointer naxatw-text-[#D73F3F] hover:naxatw-opacity-75"
          onClick={() => navigate(`/projects/${id}`)}
        >
          arrow_back
        </button>
        <span className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-800">
          {projectName ? m.viewer_3d_title({ projectName }) : m.viewer_3d_fallback_title()}
        </span>
      </div>

      <div className="naxatw-relative naxatw-flex-1">
        <div ref={mapContainerRef} className="naxatw-h-full naxatw-w-full" />

        {modelState === "loaded" && (
          <button
            type="button"
            aria-label={m.viewer_3d_recenter()}
            title={m.viewer_3d_recenter()}
            className="naxatw-absolute naxatw-right-4 naxatw-top-4 naxatw-z-10 naxatw-flex naxatw-h-10 naxatw-w-10 naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-white naxatw-shadow-lg hover:naxatw-bg-gray-50"
            onClick={handleRecenter}
          >
            <span className="material-icons naxatw-text-[#D73F3F]">center_focus_strong</span>
          </button>
        )}

        {isFetching && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-white/70">
            <span className="naxatw-text-sm naxatw-text-gray-600">
              {m.viewer_loading_project()}
            </span>
          </div>
        )}

        {!isFetching && modelState === "loading" && (
          <div className="naxatw-pointer-events-none naxatw-absolute naxatw-bottom-8 naxatw-left-1/2 naxatw-z-10 -naxatw-translate-x-1/2 naxatw-rounded naxatw-bg-white/90 naxatw-px-4 naxatw-py-2 naxatw-text-sm naxatw-text-gray-700 naxatw-shadow">
            {m.viewer_3d_loading()}
          </div>
        )}

        {!isFetching && modelState === "unavailable" && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center">
            <div className="naxatw-rounded-lg naxatw-bg-white naxatw-p-8 naxatw-text-center naxatw-shadow-xl">
              <span className="material-icons naxatw-mb-3 naxatw-block naxatw-text-4xl naxatw-text-gray-400">
                view_in_ar
              </span>
              <p className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-700">
                {m.viewer_3d_unavailable_title()}
              </p>
              <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-gray-500">
                {m.viewer_3d_unavailable_description()}
              </p>
            </div>
          </div>
        )}

        {!isFetching && modelState === "error" && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center">
            <div className="naxatw-rounded-lg naxatw-bg-white naxatw-p-8 naxatw-text-center naxatw-shadow-xl">
              <span className="material-icons naxatw-text-red-500 naxatw-mb-3 naxatw-block naxatw-text-4xl">
                error_outline
              </span>
              <p className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-700">
                {m.viewer_3d_load_failed()}
              </p>
              <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-gray-500">
                {m.viewer_retry_refresh()}
              </p>
            </div>
          </div>
        )}

        {!isFetching && modelState === "loaded" && (
          <div className="naxatw-pointer-events-none naxatw-absolute naxatw-bottom-8 naxatw-left-1/2 naxatw-z-10 -naxatw-translate-x-1/2 naxatw-rounded naxatw-bg-white/90 naxatw-px-4 naxatw-py-2 naxatw-text-sm naxatw-text-gray-600 naxatw-shadow">
            {m.viewer_3d_controls_help()}
          </div>
        )}
      </div>
    </div>
  );
};

export default hasErrorBoundary(View3DModel);
