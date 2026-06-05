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

// DRACO/KTX2 decoder assets are copied from three/examples/jsm/libs into
// public/three-libs/ at build time by vite-plugin-static-copy.  Self-hosted
// so the viewer doesn't break if a third-party CDN goes down.
const DRACO_DECODER_PATH = "/three-libs/draco/";
const KTX2_TRANSCODER_PATH = "/three-libs/basis/";

// Threshold for fatal "render aborted" - TilesRenderer fires load-error per
// tile, and transient single-tile failures shouldn't blank the whole view.
const MAX_TILE_ERRORS_BEFORE_FAIL = 25;
const MODEL_DIAGNOSTIC_TILE_LIMIT = 3;
// errorTarget is the per-pixel screen-space error the renderer is willing to
// tolerate before refining. Lower = more tiles, higher quality, more load
// pressure. 10 favors visual completeness while avoiding the request flood
// we saw with single-digit values on large textured photogrammetry.
const TILE_ERROR_TARGET = 10;
// Bound how many tiles the renderer is allowed to mutate per update tick.
// Keeps a single frame from spawning hundreds of decode jobs.
const TILE_MAX_TILES_PROCESSED = 350;
// Geometric-error target applied to the LoadRegionPlugin region that covers
// the whole tileset. Plugin computes effective error as
//   tile.geometricError - region.errorTarget + renderer.errorTarget
// and the renderer refines while effective error > renderer.errorTarget,
// so tiles only refine down until their geometricError drops below this
// number. A higher value = coarser L-O-D over the whole-model halo.
// 24 means tiles with geometricError <= ~24m render as leaves of the halo;
// the camera frustum still drives full-resolution refinement near the user.
const TILE_REGION_ERROR_TARGET = 24;
const TILE_REGION_RADIUS_MULTIPLIER = 1.35;
// LRU cache sizing. Defaults (min 600 / max 800) target small Cesium-style
// tilesets; multi-GB photogrammetry trees evict useful tiles immediately on
// pan. With LoadRegionPlugin covering the whole tileset we need headroom
// for both the coarse halo and the fine-detail set near the camera.
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

function log3dTilesDiagnostic(label: string, data?: unknown) {
  // eslint-disable-next-line no-console
  console.info(`[3D tiles] ${label}`, data ?? "");
}

function numericStat(stats: Record<string, unknown> | undefined, key: string): number | null {
  const value = stats?.[key];
  return typeof value === "number" ? value : null;
}

function matrixFromArray(matrix: Iterable<number>): THREE.Matrix4 {
  return new THREE.Matrix4().fromArray(Array.from(matrix));
}

function vectorToArray(vector: THREE.Vector3) {
  return vector.toArray().map((value) => Number(value.toFixed(6)));
}

function summarizeBoundingBox(box: unknown) {
  if (!Array.isArray(box) || box.length !== 12 || box.some((value) => typeof value !== "number")) {
    return null;
  }

  const center = new THREE.Vector3(box[0], box[1], box[2]);
  const axisX = new THREE.Vector3(box[3], box[4], box[5]);
  const axisY = new THREE.Vector3(box[6], box[7], box[8]);
  const axisZ = new THREE.Vector3(box[9], box[10], box[11]);
  const extent = new THREE.Vector3(
    Math.abs(axisX.x) + Math.abs(axisY.x) + Math.abs(axisZ.x),
    Math.abs(axisX.y) + Math.abs(axisY.y) + Math.abs(axisZ.y),
    Math.abs(axisX.z) + Math.abs(axisY.z) + Math.abs(axisZ.z),
  );
  const min = center.clone().sub(extent);
  const max = center.clone().add(extent);

  return {
    center: vectorToArray(center),
    halfAxisLengths: [axisX.length(), axisY.length(), axisZ.length()],
    localAabbMinMeters: vectorToArray(min),
    localAabbMaxMeters: vectorToArray(max),
    localZRangeMeters: [min.z, max.z],
    approximateRadius: Math.sqrt(axisX.lengthSq() + axisY.lengthSq() + axisZ.lengthSq()),
  };
}

function summarizeBox3(box: THREE.Box3) {
  if (box.isEmpty()) return null;
  const center = new THREE.Vector3();
  const size = new THREE.Vector3();
  box.getCenter(center);
  box.getSize(size);
  return {
    min: vectorToArray(box.min),
    max: vectorToArray(box.max),
    center: vectorToArray(center),
    size: vectorToArray(size),
  };
}

function expandBoxByTransformedCorners(
  target: THREE.Box3,
  source: THREE.Box3,
  matrix: THREE.Matrix4,
) {
  [source.min.x, source.max.x].forEach((x) => {
    [source.min.y, source.max.y].forEach((y) => {
      [source.min.z, source.max.z].forEach((z) => {
        target.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
      });
    });
  });
}

function getTilesetSiteBounds(tiles: TilesRenderer, ecefToSiteTransform: THREE.Matrix4) {
  const obbBox = new THREE.Box3();
  const obbMatrix = new THREE.Matrix4();
  if (!tiles.getOrientedBoundingBox(obbBox, obbMatrix)) return null;

  const siteBounds = new THREE.Box3();
  const obbToSite = ecefToSiteTransform.clone().multiply(obbMatrix);
  expandBoxByTransformedCorners(siteBounds, obbBox, obbToSite);
  return siteBounds;
}

function getEastNorthUp(lng: number, lat: number) {
  const lngRad = (lng * Math.PI) / 180;
  const latRad = (lat * Math.PI) / 180;
  const east = new THREE.Vector3(-Math.sin(lngRad), Math.cos(lngRad), 0).normalize();
  const north = new THREE.Vector3(
    -Math.sin(latRad) * Math.cos(lngRad),
    -Math.sin(latRad) * Math.sin(lngRad),
    Math.cos(latRad),
  ).normalize();
  const up = new THREE.Vector3(
    Math.cos(latRad) * Math.cos(lngRad),
    Math.cos(latRad) * Math.sin(lngRad),
    Math.sin(latRad),
  ).normalize();
  return { east, north, up };
}

function axisDirections(matrix: THREE.Matrix4) {
  return {
    x: vectorToArray(new THREE.Vector3(1, 0, 0).transformDirection(matrix)),
    y: vectorToArray(new THREE.Vector3(0, 1, 0).transformDirection(matrix)),
    z: vectorToArray(new THREE.Vector3(0, 0, 1).transformDirection(matrix)),
  };
}

function getUpCorrectionMatrix(gltfUpAxis: unknown) {
  const axis = typeof gltfUpAxis === "string" ? gltfUpAxis.toLowerCase() : "y";
  if (axis === "x") {
    return new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(0, 1, 0), -Math.PI / 2);
  }
  if (axis === "y") {
    return new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
  }
  return new THREE.Matrix4();
}

function forceRendererContentZUp(tiles: TilesRenderer) {
  const upRotationMatrixKey = "_upRotationMatrix";
  const internalTiles = tiles as unknown as {
    [upRotationMatrixKey]?: THREE.Matrix4;
  };
  internalTiles[upRotationMatrixKey]?.identity();
}

function configureTilesRendererForPhotogrammetry(tiles: TilesRenderer) {
  const rendererTiles = tiles;
  // Defaults target small Cesium-style tilesets, not multi-GB textured
  // photogrammetry. Without these overrides, tiles cull aggressively at the
  // screen edges and the LRU evicts them immediately, so panning causes the
  // visible "squares" to pop in and out.
  rendererTiles.errorTarget = TILE_ERROR_TARGET;
  rendererTiles.maxTilesProcessed = TILE_MAX_TILES_PROCESSED;
  rendererTiles.optimizedLoadStrategy = true;
  rendererTiles.loadSiblings = true;
  // Render tiles that have been loaded into the active set even when they
  // fall outside the render camera's frustum. Combined with LoadRegionPlugin
  // this keeps a halo of already-loaded tiles visible while panning.
  rendererTiles.displayActiveTiles = true;
  rendererTiles.lruCache.minSize = TILE_LRU_MIN_SIZE;
  rendererTiles.lruCache.maxSize = TILE_LRU_MAX_SIZE;
  rendererTiles.lruCache.minBytesSize = TILE_LRU_MIN_BYTES;
  rendererTiles.lruCache.maxBytesSize = TILE_LRU_MAX_BYTES;
  rendererTiles.downloadQueue.maxJobs = TILE_DOWNLOAD_CONCURRENCY;
  rendererTiles.parseQueue.maxJobs = TILE_PARSE_CONCURRENCY;
}

function repairTilesetGeometricErrors(root: unknown) {
  let adjustedEmptyParents = 0;
  let adjustedRenderableParents = 0;
  let initializedRenderableTiles = 0;
  const samples: Array<{
    reason: string;
    original: number | null;
    adjusted: number;
    maxRenderableChild?: number;
  }> = [];

  function sample(
    reason: string,
    original: number | null,
    adjusted: number,
    maxRenderableChild?: number,
  ) {
    if (samples.length >= 5) return;
    samples.push({ reason, original, adjusted, maxRenderableChild });
  }

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
        adjustedEmptyParents += 1;
        sample("empty-parent-forced-refine", original, record.geometricError, maxRenderableChild);
      }
      return record.geometricError as number;
    }

    if (original === null) {
      const adjusted = maxRenderableChild === null ? 0 : maxRenderableChild * 1.01;
      record.geometricError = Number(adjusted.toFixed(6));
      initializedRenderableTiles += 1;
      sample("renderable-missing-error", original, record.geometricError, maxRenderableChild ?? 0);
      return record.geometricError as number;
    }

    if (maxRenderableChild !== null && original < maxRenderableChild) {
      record.geometricError = Number((maxRenderableChild * 1.01).toFixed(6));
      adjustedRenderableParents += 1;
      sample(
        "renderable-parent-child-error-order",
        original,
        record.geometricError,
        maxRenderableChild,
      );
    }

    return record.geometricError as number;
  }

  visit(root);
  return {
    adjustedEmptyParents,
    adjustedRenderableParents,
    initializedRenderableTiles,
    samples,
  };
}

// 3D Tiles store geometry in ECEF (Earth-Centred Earth-Fixed). This converts
// the tileset bounding-sphere centre to geographic coordinates so we can place
// the Mercator transform and jump the map camera to the right location.
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

function summarizeRootTransform(
  transform: unknown,
  lng: number,
  lat: number,
  center: THREE.Vector3,
) {
  if (
    !Array.isArray(transform) ||
    transform.length !== 16 ||
    transform.some((value) => typeof value !== "number")
  ) {
    return null;
  }

  const { east, north, up } = getEastNorthUp(lng, lat);
  const columns = {
    x: new THREE.Vector3(transform[0], transform[1], transform[2]),
    y: new THREE.Vector3(transform[4], transform[5], transform[6]),
    z: new THREE.Vector3(transform[8], transform[9], transform[10]),
  };
  const translation = new THREE.Vector3(transform[12], transform[13], transform[14]);
  const normalized = {
    x: columns.x.clone().normalize(),
    y: columns.y.clone().normalize(),
    z: columns.z.clone().normalize(),
  };
  const upDots = {
    x: normalized.x.dot(up),
    y: normalized.y.dot(up),
    z: normalized.z.dot(up),
  };
  const inferredUpAxis = Object.entries(upDots).reduce((best, current) =>
    Math.abs(current[1]) > Math.abs(best[1]) ? current : best,
  )[0];

  return {
    translationEcef: vectorToArray(translation),
    translationLngLatAlt: ecefToLngLatAlt(translation.x, translation.y, translation.z),
    centerOffsetFromTranslationMeters: Number(center.distanceTo(translation).toFixed(3)),
    basisLengths: {
      x: Number(columns.x.length().toFixed(6)),
      y: Number(columns.y.length().toFixed(6)),
      z: Number(columns.z.length().toFixed(6)),
    },
    basisDotProducts: {
      xy: Number(normalized.x.dot(normalized.y).toFixed(6)),
      xz: Number(normalized.x.dot(normalized.z).toFixed(6)),
      yz: Number(normalized.y.dot(normalized.z).toFixed(6)),
    },
    basisAlignmentWithEastNorthUp: {
      x: {
        east: Number(normalized.x.dot(east).toFixed(6)),
        north: Number(normalized.x.dot(north).toFixed(6)),
        up: Number(upDots.x.toFixed(6)),
      },
      y: {
        east: Number(normalized.y.dot(east).toFixed(6)),
        north: Number(normalized.y.dot(north).toFixed(6)),
        up: Number(upDots.y.toFixed(6)),
      },
      z: {
        east: Number(normalized.z.dot(east).toFixed(6)),
        north: Number(normalized.z.dot(north).toFixed(6)),
        up: Number(upDots.z.toFixed(6)),
      },
    },
    determinant: Number(columns.x.dot(columns.y.clone().cross(columns.z)).toFixed(6)),
    inferredTilesetLocalUpAxis: inferredUpAxis,
  };
}

function summarizeTilesetContent(root: unknown) {
  let nodes = 0;
  let contentNodes = 0;
  let maxDepth = 0;
  const extensions = new Set<string>();

  function visit(tile: unknown, depth: number) {
    const record = tile as Record<string, any> | null;
    if (!record) return;
    nodes += 1;
    maxDepth = Math.max(maxDepth, depth);
    if (record.content || record.contents) contentNodes += 1;
    if (record.content?.uri) {
      const match = String(record.content.uri).match(/\.([a-z0-9]+)$/i);
      if (match) extensions.add(match[1].toLowerCase());
    }
    if (Array.isArray(record.children)) {
      record.children.forEach((child) => visit(child, depth + 1));
    }
  }

  visit(root, 0);
  return {
    nodes,
    contentNodes,
    maxDepth,
    contentExtensions: Array.from(extensions).sort(),
  };
}

function summarizeTileStreaming(tiles: TilesRenderer | null) {
  if (!tiles) return null;
  const tileInternals = tiles as unknown as {
    queuedTiles?: unknown[];
    stats?: Record<string, unknown>;
  };
  const { stats } = tileInternals;
  return {
    stats: {
      queued: numericStat(stats, "queued"),
      downloading: numericStat(stats, "downloading"),
      parsing: numericStat(stats, "parsing"),
      loaded: numericStat(stats, "loaded"),
      failed: numericStat(stats, "failed"),
      inFrustum: numericStat(stats, "inFrustum"),
      used: numericStat(stats, "used"),
      active: numericStat(stats, "active"),
      visible: numericStat(stats, "visible"),
      tilesProcessed: numericStat(stats, "tilesProcessed"),
      traversed: numericStat(stats, "traversed"),
    },
    queuedTiles: tileInternals.queuedTiles?.length,
  };
}

function summarizeLoadedModelScene(
  scene: THREE.Object3D | undefined,
  tile: Record<string, any> | undefined,
  tilesGroup: THREE.Group,
  siteToMapTransform: THREE.Matrix4,
) {
  if (!scene) return null;

  let meshCount = 0;
  let texturedMeshCount = 0;
  scene.traverse((object) => {
    const mesh = object as THREE.Mesh;
    if (!mesh.isMesh) return;
    meshCount += 1;
    const materials = Array.isArray(mesh.material) ? mesh.material : [mesh.material];
    if (materials.some((material) => material && "map" in material && material.map)) {
      texturedMeshCount += 1;
    }
  });

  scene.updateMatrixWorld(true);
  const sceneParentIsTilesGroup = scene.parent === tilesGroup;
  const sceneBox = new THREE.Box3().setFromObject(scene);
  const siteBox = sceneParentIsTilesGroup
    ? sceneBox
    : sceneBox.clone().applyMatrix4(tilesGroup.matrix);
  const sceneToMap = siteToMapTransform.clone().multiply(tilesGroup.matrix).multiply(scene.matrix);

  return {
    url: tile?.content?.uri,
    tileRefine: tile?.refine,
    tileGeometricError: tile?.geometricError,
    meshCount,
    texturedMeshCount,
    sceneParentIsTilesGroup,
    sceneBoxBeforeTilesGroup: summarizeBox3(sceneBox),
    sceneBoxAfterTilesGroupMeters: summarizeBox3(siteBox),
    sceneLocalAxisDirectionsInMapSpace: axisDirections(sceneToMap),
  };
}

const View3DModel = () => {
  const { id } = useParams<{ id: string }>();
  const navigate = useNavigate();
  const mapContainerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<maplibregl.Map | null>(null);
  // Set when the tileset finishes loading; used by the re-centre button to
  // fly back to the model after the user has panned/zoomed away.
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

  const { data: projectData, isFetching } = useGetProjectsDetailQuery(id as string);

  useEffect(() => {
    if (!mapContainerRef.current || isFetching || !projectData) return undefined;
    if (mapRef.current) return undefined;

    // tileset.json (and every .b3dm referenced by relative URL inside it) is
    // served directly from S3/CDN under publicuploads/, so no auth, no proxy,
    // no per-tile DB lookups. Absence of the URL means the cloudnative job
    // hasn't produced tiles for this project yet.
    const tilesetUrl = (projectData as Record<string, any>).cloud_mesh_tileset_url as
      | string
      | null
      | undefined;
    if (!tilesetUrl) {
      setModelState("unavailable");
      return undefined;
    }

    const projectCentroid = (projectData as Record<string, any>).outline
      ? centroid((projectData as Record<string, any>).outline).geometry.coordinates
      : [0, 0];
    const [initLng, initLat] = projectCentroid as [number, number];

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

    // Resources shared across onAdd / render via closure.  Tracked at the
    // effect-scope level so cleanup can dispose them all.
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
    let modelDiagnosticCount = 0;
    let tilesLoadEndLogged = false;

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
      // LoadRegionPlugin lets us force a coarse halo of tiles to stay loaded
      // over the entire model regardless of camera frustum - so when the
      // user zooms out, the whole thing is visible instead of just whatever
      // happens to be inside the view frustum. The actual region is added
      // in load-tileset once we know the bounding sphere.
      regionPlugin = new LoadRegionPlugin();
      tiles.registerPlugin(regionPlugin);
      sceneInst.add(tiles.group);
      tiles.setCamera(cameraInst);
      tiles.setResolutionFromRenderer(cameraInst, rendererInst);
      tiles.manager.addHandler(/\.(gltf|glb)$/g, gltfLoader);

      let handled = false;
      const onLoadTileset = (event: any) => {
        if (handled || !tiles) return;
        handled = true;
        tiles.removeEventListener("load-tileset", onLoadTileset);

        const sphere = new THREE.Sphere();
        tiles.getBoundingSphere(sphere);
        const centre = sphere.center.clone();
        const { lng, lat, alt } = ecefToLngLatAlt(centre.x, centre.y, centre.z);
        const { root } = tiles;
        const rootBox = (root?.boundingVolume as Record<string, unknown> | undefined)?.box;
        const tilesetRepairs = repairTilesetGeometricErrors(root);

        if (cancelled) return;

        // Force the whole tileset to load at a coarse L-O-D by registering a
        // SphereRegion that covers it. The plugin marks every tile inside
        // the sphere as in-view (with the region's geometric-error budget),
        // composed via max() with the camera's own per-tile error - so the
        // user sees the entire model when zoomed out, while camera-frustum
        // selection still drives full-resolution refinement nearby. Sphere
        // is in the tileset's native (ECEF) space, matching tile bounding
        // volumes. Pad the radius slightly so border tiles whose AABBs
        // poke outside the loose bounding sphere still intersect.
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
        // a data issue (georeferencing in Obj2Tiles input) and must be fixed
        // upstream, not patched here.
        localTransform = buildLocalTransform(lng, lat, alt);

        let m: number[] = [1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1, 0, 0, 0, 0, 1];
        if (root && (root as Record<string, any>).transform) {
          m = (root as Record<string, any>).transform as number[];
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
        const siteBounds = getTilesetSiteBounds(tiles, finalMatrix);

        const tilesetJson = event?.tileset as Record<string, any> | undefined;
        const asset = tilesetJson?.asset as Record<string, unknown> | undefined;
        const rootRecord = root as unknown as Record<string, unknown> | null;
        const rootTransform = Array.isArray(rootRecord?.transform)
          ? (rootRecord.transform as number[])
          : m;
        const rootTransformMatrix = matrixFromArray(rootTransform);
        const rootTransformSummary = summarizeRootTransform(rootTransform, lng, lat, centre);
        const declaredGltfUpAxis =
          typeof asset?.gltfUpAxis === "string" ? asset.gltfUpAxis.toLowerCase() : null;
        const forceZUpContent =
          rootTransformSummary?.inferredTilesetLocalUpAxis === "z" &&
          (!declaredGltfUpAxis || declaredGltfUpAxis === "y");
        if (forceZUpContent) {
          forceRendererContentZUp(tiles);
        }

        const sourceToMapNoCorrection = localTransform
          .clone()
          .multiply(finalMatrix)
          .multiply(rootTransformMatrix);
        const sourceToMapWithDefaultCorrection = sourceToMapNoCorrection
          .clone()
          .multiply(getUpCorrectionMatrix(asset?.gltfUpAxis));
        const sourceToMapWithActiveCorrection = forceZUpContent
          ? sourceToMapNoCorrection.clone()
          : sourceToMapWithDefaultCorrection;

        log3dTilesDiagnostic("alignment", {
          tilesetUrl: url,
          asset: {
            version: asset?.version,
            tilesetVersion: asset?.tilesetVersion,
            gltfUpAxis: asset?.gltfUpAxis ?? null,
            rendererDefaultWhenMissing: "y",
          },
          rendererGltfUpAxisHandling: {
            forcedZUpContent: forceZUpContent,
            reason: forceZUpContent
              ? "Root transform says local Z is vertical, so skip 3d-tiles-renderer's default Y-up glTF correction for ODM/obj2tiles B3DM content."
              : "Using 3d-tiles-renderer's declared/default glTF up-axis correction.",
          },
          geographicCenter: { lng, lat, alt },
          ecefSphereCenter: vectorToArray(centre),
          ecefSphereCenterLength: Number(centre.length().toFixed(3)),
          sphereRadiusMeters: Number(sphere.radius.toFixed(3)),
          rootBoundingBox: summarizeBoundingBox(rootBox),
          surfacePlacement: {
            siteBoundsMeters: siteBounds ? summarizeBox3(siteBounds) : null,
            lowestPointAltitudeMeters:
              siteBounds === null ? null : Number((alt + siteBounds.min.z).toFixed(3)),
            highestPointAltitudeMeters:
              siteBounds === null ? null : Number((alt + siteBounds.max.z).toFixed(3)),
            offsetToPutLowestBoundOnMapSurfaceMeters:
              siteBounds === null ? null : Number((-alt - siteBounds.min.z).toFixed(3)),
          },
          rootTransform: rootTransformSummary,
          content: summarizeTilesetContent(root),
          rendererTileOptions: {
            errorTarget: TILE_ERROR_TARGET,
            maxTilesProcessed: TILE_MAX_TILES_PROCESSED,
            optimizedLoadStrategy: true,
            loadSiblings: true,
            displayActiveTiles: true,
            wholeModelRegionErrorTarget: TILE_REGION_ERROR_TARGET,
            wholeModelRegionRadiusMultiplier: TILE_REGION_RADIUS_MULTIPLIER,
            maxDownloadJobs: TILE_DOWNLOAD_CONCURRENCY,
            maxParseJobs: TILE_PARSE_CONCURRENCY,
            fadeDurationMs: TILE_FADE_DURATION_MS,
            maxFadeOutTiles: TILE_FADE_OUT_LIMIT,
            lruCache: {
              minSize: TILE_LRU_MIN_SIZE,
              maxSize: TILE_LRU_MAX_SIZE,
              minBytesSize: TILE_LRU_MIN_BYTES,
              maxBytesSize: TILE_LRU_MAX_BYTES,
            },
          },
          tilesetRepairs,
          sourceAxisDirectionsIfContentIsAlreadyZUp: axisDirections(sourceToMapNoCorrection),
          sourceAxisDirectionsWithDefaultRendererCorrection: axisDirections(
            sourceToMapWithDefaultCorrection,
          ),
          activeSourceAxisDirections: axisDirections(sourceToMapWithActiveCorrection),
        });

        // Don't flip to "loaded" here. tileset.json parsing finishing only
        // means metadata is available; no mesh is visible yet. Wait for the
        // first load-model event so the loading overlay stays up until the
        // user actually sees something.
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
      tiles.addEventListener("load-model", (event: any) => {
        if (!firstModelLoaded && !cancelled) {
          firstModelLoaded = true;
          setModelState("loaded");
        }
        if (modelDiagnosticCount >= MODEL_DIAGNOSTIC_TILE_LIMIT || !tiles || !localTransform)
          return;
        modelDiagnosticCount += 1;
        log3dTilesDiagnostic(
          "model-content",
          summarizeLoadedModelScene(event?.scene, event?.tile, tiles.group, localTransform),
        );
      });
      tiles.addEventListener("tiles-load-end", () => {
        if (tilesLoadEndLogged) return;
        tilesLoadEndLogged = true;
        log3dTilesDiagnostic("streaming-complete", summarizeTileStreaming(tiles));
      });

      // Seed localTransform with a placeholder so render() will call
      // tiles.update() - which is what actually triggers the tileset.json
      // fetch.  onLoadTileset replaces this with the real georeferencing.
      localTransform = buildLocalTransform(0, 0, 0);

      // load-error fires per failed asset.  Failing on the tileset itself is
      // fatal; sporadic tile failures aren't (TilesRenderer retries cheaply
      // on the next update).  Only flip to 'error' once a threshold is hit.
      tiles.addEventListener("load-error", (event: any) => {
        const failedUrl: string | undefined = event?.url;
        const isTileset = !!failedUrl && failedUrl.endsWith("tileset.json");
        log3dTilesDiagnostic("load-error", {
          url: failedUrl,
          isTileset,
          error: event?.error,
          stats: summarizeTileStreaming(tiles),
        });
        if (isTileset) {
          // eslint-disable-next-line no-console
          console.error("Failed to load tileset.json", event?.error);
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
        // (identity) position/quaternion/scale on every frame, which would
        // wipe out the matrixWorld we copy in from MapLibre and make
        // 3d-tiles-renderer cull/select tiles from the wrong viewpoint.
        // That's the most likely cause of holes/disappearing chunks while
        // panning and zooming.
        tilesCamera.matrixAutoUpdate = false;
        initTiles(tilesetUrl, scene, tilesCamera, renderer);
      },
      // maplibre-gl v4: render(gl, matrix, options). The second argument is
      // transform.customLayerMatrix(), i.e. the matrix for Mercator custom
      // layer coordinates. options.modelViewProjectionMatrix uses MapLibre's
      // internal world-space coordinates and must not be mixed with
      // MercatorCoordinate.fromLngLat output.
      render(_gl, matrix, options: CustomRenderMethodInput) {
        if (!camera || !renderer || !scene || !localTransform || !tilesCamera) return;

        camera.projectionMatrix.fromArray(Array.from(matrix as Iterable<number>));
        camera.projectionMatrix.multiply(localTransform);

        const P = matrixFromArray(options.projectionMatrix as Iterable<number>);
        const V = new THREE.Matrix4().multiplyMatrices(P.clone().invert(), camera.projectionMatrix);

        tilesCamera.projectionMatrix.copy(P);
        // Keep projectionMatrixInverse coherent with projectionMatrix.
        // 3d-tiles-renderer uses both when computing screen-space error;
        // a stale inverse causes the wrong tiles to be picked.
        tilesCamera.projectionMatrixInverse.copy(P).invert();
        tilesCamera.matrixWorldInverse.copy(V);
        tilesCamera.matrixWorld.copy(V).invert();
        updateTileResolution();

        // Update tile selection/loading state before drawing the frame so
        // the renderer renders against the most recent visible set rather
        // than always lagging one frame behind camera motion.
        tiles?.update();
        renderer.resetState();
        renderer.render(scene, camera);
        // No unconditional triggerRepaint here. MapLibre repaints on its
        // own during user interaction, and the tiles "needs-update" handler
        // schedules a repaint when async loads / tile-set changes happen.
        // Forcing 60fps repaint here just pins the GPU and main thread
        // during streaming.
      },
    };

    // Backend already confirmed tile availability via cloud_mesh_tileset_url
    // being populated, so we go straight to adding the layer. TilesRenderer's
    // own load-error handler covers the residual case where the object was
    // deleted out-of-band after the flag was set.
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
      // Tiles owns its WebGL geometries/textures and disposes them via the
      // tile-manager when the renderer is removed from the scene. The
      // TilesRenderer's own dispose() iterates registered plugins and
      // calls their dispose() too, so the region plugin is torn down here.
      tiles?.dispose();
      tiles = null;
      regionPlugin = null;
      fadePlugin = null;
      // KTX2/DRACO loaders own worker pools that must be torn down.
      ktx2Loader?.dispose();
      dracoLoader?.dispose();
      ktx2Loader = null;
      dracoLoader = null;
      // Three.js renderer holds the GL context; map.remove() will too, but
      // disposing here releases shaders/buffers explicitly.
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
  }, [projectData, isFetching]);

  const projectName = (projectData as Record<string, any>)?.name as string | undefined;

  return (
    <div className="naxatw-relative naxatw-flex naxatw-h-screen naxatw-flex-col">
      <div className="naxatw-flex naxatw-items-center naxatw-gap-3 naxatw-border-b naxatw-bg-white naxatw-px-6 naxatw-py-3">
        <button
          type="button"
          aria-label="Back to project"
          className="material-icons naxatw-cursor-pointer naxatw-text-[#D73F3F] hover:naxatw-opacity-75"
          onClick={() => navigate(`/projects/${id}`)}
        >
          arrow_back
        </button>
        <span className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-800">
          {projectName ? `${projectName} - 3D Model` : "3D Model Viewer"}
        </span>
      </div>

      <div className="naxatw-relative naxatw-flex-1">
        <div ref={mapContainerRef} className="naxatw-h-full naxatw-w-full" />

        {modelState === "loaded" && (
          <button
            type="button"
            aria-label="Re-centre on 3D model"
            title="Re-centre on 3D model"
            className="naxatw-absolute naxatw-right-4 naxatw-top-4 naxatw-z-10 naxatw-flex naxatw-h-10 naxatw-w-10 naxatw-cursor-pointer naxatw-items-center naxatw-justify-center naxatw-rounded-full naxatw-bg-white naxatw-shadow-lg hover:naxatw-bg-gray-50"
            onClick={handleRecenter}
          >
            <span className="material-icons naxatw-text-[#D73F3F]">center_focus_strong</span>
          </button>
        )}

        {isFetching && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center naxatw-bg-white/70">
            <span className="naxatw-text-sm naxatw-text-gray-600">Loading project…</span>
          </div>
        )}

        {!isFetching && modelState === "loading" && (
          <div className="naxatw-pointer-events-none naxatw-absolute naxatw-bottom-8 naxatw-left-1/2 naxatw-z-10 -naxatw-translate-x-1/2 naxatw-rounded naxatw-bg-white/90 naxatw-px-4 naxatw-py-2 naxatw-text-sm naxatw-text-gray-700 naxatw-shadow">
            Loading 3D model…
          </div>
        )}

        {!isFetching && modelState === "unavailable" && (
          <div className="naxatw-absolute naxatw-inset-0 naxatw-flex naxatw-items-center naxatw-justify-center">
            <div className="naxatw-rounded-lg naxatw-bg-white naxatw-p-8 naxatw-text-center naxatw-shadow-xl">
              <span className="material-icons naxatw-mb-3 naxatw-block naxatw-text-4xl naxatw-text-gray-400">
                view_in_ar
              </span>
              <p className="naxatw-text-base naxatw-font-semibold naxatw-text-gray-700">
                3D model not yet generated
              </p>
              <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-gray-500">
                The 3D model will be available after it&apos;s been post-processed.
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
                Failed to load 3D model
              </p>
              <p className="naxatw-mt-1 naxatw-text-sm naxatw-text-gray-500">
                Try refreshing the page. If the problem persists, check the project&apos;s 3D tiles
                in S3.
              </p>
            </div>
          </div>
        )}

        {!isFetching && modelState === "loaded" && (
          <div className="naxatw-pointer-events-none naxatw-absolute naxatw-bottom-8 naxatw-left-1/2 naxatw-z-10 -naxatw-translate-x-1/2 naxatw-rounded naxatw-bg-white/90 naxatw-px-4 naxatw-py-2 naxatw-text-sm naxatw-text-gray-600 naxatw-shadow">
            Drag to pan · Scroll to zoom · Right-click drag to rotate
          </div>
        )}
      </div>
    </div>
  );
};

export default hasErrorBoundary(View3DModel);
