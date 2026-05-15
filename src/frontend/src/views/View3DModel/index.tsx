import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import maplibregl, { type CustomLayerInterface, type CustomRenderMethodInput } from "maplibre-gl";
import "maplibre-gl/dist/maplibre-gl.css";
import * as THREE from "three";
import { GLTFLoader } from "three/addons/loaders/GLTFLoader.js";
import { DRACOLoader } from "three/addons/loaders/DRACOLoader.js";
import { KTX2Loader } from "three/addons/loaders/KTX2Loader.js";
import { TilesRenderer } from "3d-tiles-renderer";
import centroid from "@turf/centroid";
import { useGetProjectsDetailQuery } from "@Api/projects";
import hasErrorBoundary from "@Utils/hasErrorBoundary";
import { getRuntimeConfig } from "@/runtimeConfig";

const API_URL = getRuntimeConfig("VITE_API_URL", "/api").replace(/\/+$/, "");

// DRACO/KTX2 decoder assets are copied from three/examples/jsm/libs into
// public/three-libs/ at build time by vite-plugin-static-copy.  Self-hosted
// so the viewer doesn't break if a third-party CDN goes down.
const DRACO_DECODER_PATH = "/three-libs/draco/";
const KTX2_TRANSCODER_PATH = "/three-libs/basis/";

// Threshold for fatal "render aborted" - TilesRenderer fires load-error per
// tile, and transient single-tile failures shouldn't blank the whole view.
const MAX_TILE_ERRORS_BEFORE_FAIL = 5;
const MODEL_DIAGNOSTIC_TILE_LIMIT = 3;
const TILE_CACHE_MAX_BYTES = 1024 * 1024 * 1024;
const TILE_CACHE_MIN_BYTES = 768 * 1024 * 1024;
const TILE_MAX_TILES_PROCESSED = 1000;
const TILE_ERROR_TARGET = 8;
const EMPTY_PARENT_GEOMETRIC_ERROR = 1_000_000_000;
const DEFAULT_MODEL_ALTITUDE_OFFSET_METERS = 0;
const PREFETCH_ALL_RENDERABLE_TILES = true;
const MAX_PREFETCH_RENDERABLE_TILES = 3000;

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

function getConfiguredModelAltitudeOffsetMeters() {
  if (typeof window === "undefined") return DEFAULT_MODEL_ALTITUDE_OFFSET_METERS;
  const rawValue = new URLSearchParams(window.location.search).get("modelAltOffset");
  if (rawValue === null) return DEFAULT_MODEL_ALTITUDE_OFFSET_METERS;
  const value = Number(rawValue);
  return Number.isFinite(value) ? value : DEFAULT_MODEL_ALTITUDE_OFFSET_METERS;
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
  for (const x of [source.min.x, source.max.x]) {
    for (const y of [source.min.y, source.max.y]) {
      for (const z of [source.min.z, source.max.z]) {
        target.expandByPoint(new THREE.Vector3(x, y, z).applyMatrix4(matrix));
      }
    }
  }
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
  const internalTiles = tiles as unknown as { _upRotationMatrix?: THREE.Matrix4 };
  internalTiles._upRotationMatrix?.identity();
}

function configureTilesRendererForPhotogrammetry(tiles: TilesRenderer) {
  const internalTiles = tiles as unknown as {
    errorTarget?: number;
    maxTilesProcessed?: number;
    optimizedLoadStrategy?: boolean;
    loadSiblings?: boolean;
    displayActiveTiles?: boolean;
    lruCache?: {
      minBytesSize?: number;
      maxBytesSize?: number;
    };
  };

  internalTiles.errorTarget = TILE_ERROR_TARGET;
  internalTiles.maxTilesProcessed = TILE_MAX_TILES_PROCESSED;
  internalTiles.optimizedLoadStrategy = true;
  internalTiles.loadSiblings = true;
  internalTiles.displayActiveTiles = true;
  if (internalTiles.lruCache) {
    internalTiles.lruCache.minBytesSize = TILE_CACHE_MIN_BYTES;
    internalTiles.lruCache.maxBytesSize = TILE_CACHE_MAX_BYTES;
  }
}

function prefetchRenderableTiles(tiles: TilesRenderer) {
  if (!PREFETCH_ALL_RENDERABLE_TILES) {
    return { enabled: false };
  }

  let renderableTiles = 0;
  let requestedTiles = 0;
  let alreadyLoadingOrLoaded = 0;
  let skippedByLimit = 0;

  const internalTiles = tiles as unknown as {
    requestTileContents?: (tile: unknown) => unknown;
    lruCache?: { markUsed?: (tile: unknown) => void };
  };

  tiles.traverse((tile: unknown) => {
    const record = tile as Record<string, any> | null;
    if (!record?.internal?.hasRenderableContent) return false;

    renderableTiles += 1;
    if (record.internal.loadingState !== 0) {
      alreadyLoadingOrLoaded += 1;
      return false;
    }

    if (requestedTiles >= MAX_PREFETCH_RENDERABLE_TILES) {
      skippedByLimit += 1;
      return false;
    }

    internalTiles.lruCache?.markUsed?.(record);
    const request = internalTiles.requestTileContents?.(record);
    if (request) {
      requestedTiles += 1;
    }

    return false;
  }, null);

  return {
    enabled: true,
    renderableTiles,
    requestedTiles,
    alreadyLoadingOrLoaded,
    skippedByLimit,
    maxPrefetchRenderableTiles: MAX_PREFETCH_RENDERABLE_TILES,
  };
}

function normalizeTilesetGeometricErrors(root: unknown) {
  let adjustedRenderableParents = 0;
  let forcedEmptyParents = 0;
  const samples: Array<{
    reason: string;
    original: number | null;
    adjusted: number;
    maxRenderableChild?: number;
  }> = [];

  function visit(tile: unknown): number | null {
    const record = tile as Record<string, any> | null;
    if (!record) return null;

    const children = Array.isArray(record.children) ? record.children : [];
    const hasChildren = children.length > 0;
    const hasRenderableContent = !!record.content || !!record.contents;
    const childRenderableErrors = hasChildren
      ? children.map(visit).filter((value: number | null): value is number => value !== null)
      : [];
    const maxRenderableChild = childRenderableErrors.length
      ? Math.max(...childRenderableErrors)
      : null;
    const original = typeof record.geometricError === "number" ? record.geometricError : null;

    if (
      !hasRenderableContent &&
      hasChildren &&
      (original === null || original < EMPTY_PARENT_GEOMETRIC_ERROR)
    ) {
      record.geometricError = EMPTY_PARENT_GEOMETRIC_ERROR;
      forcedEmptyParents += 1;
      if (samples.length < 5) {
        samples.push({
          reason: "empty-parent-forced-refine",
          original,
          adjusted: record.geometricError,
        });
      }
      return maxRenderableChild;
    }

    if (
      hasRenderableContent &&
      original !== null &&
      maxRenderableChild !== null &&
      original < maxRenderableChild
    ) {
      record.geometricError = Number((maxRenderableChild * 1.01).toFixed(6));
      adjustedRenderableParents += 1;
      if (samples.length < 5) {
        samples.push({
          reason: "renderable-parent-child-error-order",
          original,
          adjusted: record.geometricError,
          maxRenderableChild,
        });
      }
    }

    if (hasRenderableContent) {
      return typeof record.geometricError === "number" ? record.geometricError : maxRenderableChild;
    }

    return maxRenderableChild;
  }

  visit(root);
  return { adjustedRenderableParents, forcedEmptyParents, samples };
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
  return { nodes, contentNodes, maxDepth, contentExtensions: Array.from(extensions).sort() };
}

function summarizeTileStreaming(tiles: TilesRenderer | null) {
  if (!tiles) return null;
  const tileInternals = tiles as unknown as {
    queuedTiles?: unknown[];
    stats?: Record<string, unknown>;
  };
  const stats = tileInternals.stats;
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
  const lat = Math.atan2(
    z + ep2 * b * Math.pow(Math.sin(th), 3),
    p - e2 * a * Math.pow(Math.cos(th), 3),
  );
  const n = a / Math.sqrt(1 - e2 * Math.sin(lat) * Math.sin(lat));
  const alt = p / Math.cos(lat) - n;
  return { lng: (lon * 180) / Math.PI, lat: (lat * 180) / Math.PI, alt };
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
    if (!mapContainerRef.current || isFetching || !projectData) return;
    if (mapRef.current) return;

    // Use the project UUID from the API response - route param may be a slug.
    const projectId = (projectData as Record<string, any>).id as string;
    const tilesetUrl = `${API_URL}/projects/${projectId}/3d-tiles/tileset.json`;
    const token = localStorage.getItem("token");
    const authHeaders: Record<string, string> = {};
    if (token) authHeaders["Access-token"] = token;

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
    let dracoLoader: DRACOLoader | null = null;
    let ktx2Loader: KTX2Loader | null = null;
    let localTransform: THREE.Matrix4 | null = null;
    let cancelled = false;
    let tileErrorCount = 0;
    let modelDiagnosticCount = 0;
    let tilesLoadEndLogged = false;
    const headAbort = new AbortController();

    function buildLocalTransform(lng: number, lat: number, alt: number): THREE.Matrix4 {
      const mc = maplibregl.MercatorCoordinate.fromLngLat([lng, lat], alt);
      const scale = mc.meterInMercatorCoordinateUnits();
      const rotX = new THREE.Matrix4().makeRotationAxis(new THREE.Vector3(1, 0, 0), Math.PI / 2);
      return new THREE.Matrix4()
        .makeTranslation(mc.x, mc.y, mc.z ?? 0)
        .scale(new THREE.Vector3(scale, -scale, scale))
        .multiply(rotX);
    }

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
      // Forward the JWT so the backend proxy can enforce auth when enabled.
      if (token) tiles.fetchOptions = { headers: { ...authHeaders } };
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
        const root = tiles.root;
        const rootBox = (root?.boundingVolume as Record<string, unknown> | undefined)?.box;
        const geometricErrorNormalization = normalizeTilesetGeometricErrors(root);
        const configuredAltitudeOffsetMeters = getConfiguredModelAltitudeOffsetMeters();

        if (cancelled) return;
        modelLocationRef.current = { lng, lat };
        map.jumpTo({ center: [lng, lat], zoom: 18, pitch: 60 });
        localTransform = buildLocalTransform(lng, lat, alt + configuredAltitudeOffsetMeters);

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
        const tilePrefetch = prefetchRenderableTiles(tiles);

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
            configuredAltitudeOffsetMeters,
            siteBoundsMeters: siteBounds ? summarizeBox3(siteBounds) : null,
            lowestPointAltitudeMeters:
              siteBounds === null
                ? null
                : Number((alt + configuredAltitudeOffsetMeters + siteBounds.min.z).toFixed(3)),
            highestPointAltitudeMeters:
              siteBounds === null
                ? null
                : Number((alt + configuredAltitudeOffsetMeters + siteBounds.max.z).toFixed(3)),
            offsetToPutLowestBoundOnMapSurfaceMeters:
              siteBounds === null ? null : Number((-alt - siteBounds.min.z).toFixed(3)),
          },
          rootTransform: rootTransformSummary,
          content: summarizeTilesetContent(root),
          geometricErrorNormalization,
          rendererTileOptions: {
            errorTarget: TILE_ERROR_TARGET,
            maxTilesProcessed: TILE_MAX_TILES_PROCESSED,
            optimizedLoadStrategy: true,
            loadSiblings: true,
            cacheMinBytes: TILE_CACHE_MIN_BYTES,
            cacheMaxBytes: TILE_CACHE_MAX_BYTES,
          },
          tilePrefetch,
          sourceAxisDirectionsIfContentIsAlreadyZUp: axisDirections(sourceToMapNoCorrection),
          sourceAxisDirectionsWithDefaultRendererCorrection: axisDirections(
            sourceToMapWithDefaultCorrection,
          ),
          activeSourceAxisDirections: axisDirections(sourceToMapWithActiveCorrection),
        });

        setModelState("loaded");
      };
      tiles.addEventListener("load-tileset", onLoadTileset);
      tiles.addEventListener("needs-update", () => {
        map.triggerRepaint();
      });
      tiles.addEventListener("load-model", (event: any) => {
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
        const url: string | undefined = event?.url;
        const isTileset = !!url && url.endsWith("tileset.json");
        log3dTilesDiagnostic("load-error", {
          url,
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
        if (tileErrorCount >= MAX_TILE_ERRORS_BEFORE_FAIL && !cancelled) {
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
        tilesCamera.matrixWorldInverse.copy(V);
        tilesCamera.matrixWorld.copy(V).invert();

        renderer.resetState();
        renderer.render(scene, camera);
        tiles?.update();
        map.triggerRepaint();
      },
    };

    // HEAD check first: show placeholder immediately if tiles haven't been
    // generated yet, without waiting for TilesRenderer to attempt a full load.
    fetch(tilesetUrl, {
      method: "HEAD",
      headers: authHeaders,
      signal: headAbort.signal,
    })
      .then((res) => {
        if (cancelled) return;
        if (res.status === 404) {
          setModelState("unavailable");
          return;
        }
        if (!res.ok) {
          log3dTilesDiagnostic("HEAD failed", { status: res.status, statusText: res.statusText });
          setModelState("error");
          return;
        }
        setModelState("loading");
        // style.load may have already fired by the time the HEAD resolves
        if (map.isStyleLoaded()) {
          if (!cancelled) map.addLayer(customLayer);
        } else {
          map.once("style.load", () => {
            if (!cancelled) map.addLayer(customLayer);
          });
        }
      })
      .catch((err) => {
        if (cancelled || err.name === "AbortError") return;
        // eslint-disable-next-line no-console
        console.error("3D tile HEAD probe failed", err);
        setModelState("error");
      });

    return () => {
      cancelled = true;
      headAbort.abort();
      // Tiles owns its WebGL geometries/textures and disposes them via the
      // tile-manager when the renderer is removed from the scene.
      tiles?.dispose();
      tiles = null;
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
              <span className="material-icons naxatw-mb-3 naxatw-block naxatw-text-4xl naxatw-text-red-500">
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
