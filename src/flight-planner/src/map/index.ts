import maplibregl, { type Map as MlMap, type LngLatBoundsLike } from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Bbox, DemSampler } from "../core/dem";
import type { FlightpathCollection, WaypointCollection } from "../core/types";
import { BasemapToggle, basemapStyle } from "./basemap";
import { drawStyles } from "./draw-styles";
import { mapColor } from "./palette";
import {
  DEM_MAX_ZOOM,
  DEM_PROTOCOL,
  DEM_TILE_SIZE,
  flightExtrusions,
  groundSampler,
  registerDemProtocol,
  Terrain3dToggle,
} from "./terrain";

export type DrawMode = "draw" | "takeoff" | "idle";

export interface TaskOutline {
  planId: string;
  label: string;
  ring: Array<[number, number]>;
}

export interface MapController {
  map: MlMap;
  ring(): Array<[number, number]> | null;
  setRing(ring: Array<[number, number]>): void;
  clearRing(): void;
  startDrawing(): void;
  setMode(mode: DrawMode): void;
  takeoff(): { lon: number; lat: number } | null;
  setTakeoff(point: { lon: number; lat: number } | null): void;
  /** `dem` is the terrain the plan was made over, which enables the 3D view. */
  showPlan(
    waypoints: WaypointCollection | null,
    path: FlightpathCollection | null,
    dem?: DemSampler | null,
  ): void;
  showTasks(tasks: TaskOutline[]): void;
  showNoFlyZones(rings: Array<Array<[number, number]>>): void;
  onTaskClick(handler: (planId: string) => void): () => void;
  fitBbox(bbox: Bbox, padding?: number): void;
  onChange(handler: () => void): () => void;
  locate(): Promise<{ lon: number; lat: number }>;
}

function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

function ringCentre(ring: Array<[number, number]>): [number, number] {
  let [minx, miny, maxx, maxy] = [Infinity, Infinity, -Infinity, -Infinity];
  for (const [lon, lat] of ring) {
    minx = Math.min(minx, lon);
    miny = Math.min(miny, lat);
    maxx = Math.max(maxx, lon);
    maxy = Math.max(maxy, lat);
  }
  return [(minx + maxx) / 2, (miny + maxy) / 2];
}

const TERRAIN_SOURCE = "plan-dem-terrain";
// MapLibre recommends a separate source for hillshade, so it can pick its own tiles.
const HILLSHADE_SOURCE = "plan-dem-hillshade";
const PITCH_3D = 60;

export function createMap(container: HTMLElement): MapController {
  const map = new maplibregl.Map({
    container,
    style: basemapStyle(),
    center: [0, 20],
    zoom: 2,
    attributionControl: { compact: true },
  });

  map.addControl(new BasemapToggle(), "top-right");
  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserLocation: true,
    }),
    "top-right",
  );
  const terrainToggle = new Terrain3dToggle((on) => set3d(on));
  map.addControl(terrainToggle, "top-right");
  map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

  // Web components can resize the container after MapLibre's initial layout.
  new ResizeObserver(() => map.resize()).observe(container);

  const draw = new MapboxDraw({
    displayControlsDefault: false,
    controls: {},
    defaultMode: "simple_select",
    styles: drawStyles() as never,
    // Read-only mode, so a generated plan cannot be invalidated by dragging a
    // vertex under it. draw-styles.ts already carries the `static` styling.
    modes: {
      ...MapboxDraw.modes,
      static: {
        onSetup(this: { setActionableState: () => void }) {
          this.setActionableState();
          return {};
        },
        toDisplayFeatures(_state: unknown, geojson: unknown, display: (g: unknown) => void) {
          display(geojson);
        },
      },
    },
  } as never);
  map.addControl(draw as unknown as maplibregl.IControl);

  let takeoffPoint: { lon: number; lat: number } | null = null;
  let takeoffMarker: maplibregl.Marker | null = null;
  let planStart: [number, number] | null = null;
  let planStartMarker: maplibregl.Marker | null = null;
  let mode: DrawMode = "idle";
  const changeHandlers = new Set<() => void>();
  const taskHandlers = new Set<(planId: string) => void>();
  let taskMarkers: maplibregl.Marker[] = [];
  let tasks: TaskOutline[] = [];
  let noFlyZones: Array<Array<[number, number]>> = [];
  let plan: { waypoints: WaypointCollection; path: FlightpathCollection } | null = null;
  let planDem: DemSampler | null = null;
  let terrainDem: DemSampler | null = null;
  let terrainVersion = 0;
  let is3d = false;
  let styleReady = false;

  registerDemProtocol(() => terrainDem);

  function paintNoFlyZones(): void {
    const source = map.getSource("no-fly-zones") as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: noFlyZones.map((ring) => ({
        type: "Feature" as const,
        properties: {},
        geometry: { type: "Polygon" as const, coordinates: [ring] },
      })),
    } as never);
  }

  function paintTasks(): void {
    const source = map.getSource("project-tasks") as maplibregl.GeoJSONSource | undefined;
    source?.setData({
      type: "FeatureCollection",
      features: tasks.map((task) => ({
        type: "Feature" as const,
        properties: { planId: task.planId, label: task.label },
        geometry: { type: "Polygon" as const, coordinates: [task.ring] },
      })),
    } as never);

    // DOM labels avoid an offline glyph dependency.
    for (const marker of taskMarkers) marker.remove();
    taskMarkers = tasks.map((task) => {
      const element = document.createElement("button");
      element.type = "button";
      element.className = "task-marker";
      element.textContent = task.label;
      element.title = `Plan ${task.label}`;
      element.addEventListener("click", (event) => {
        event.stopPropagation();
        if (mode === "idle") [...taskHandlers].forEach((handler) => handler(task.planId));
      });
      return new maplibregl.Marker({ element, anchor: "center" })
        .setLngLat(ringCentre(task.ring))
        .addTo(map);
    });
  }

  const notify = () => [...changeHandlers].forEach((handler) => handler());

  map.on("load", () => {
    map.addSource("project-tasks", { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "project-tasks-fill",
      type: "fill",
      source: "project-tasks",
      paint: { "fill-color": mapColor("task"), "fill-opacity": 0.08 },
    });
    map.addLayer({
      id: "project-tasks-line",
      type: "line",
      source: "project-tasks",
      paint: {
        "line-color": mapColor("task"),
        "line-width": 1.5,
        "line-opacity": 0.8,
        "line-dasharray": [2, 2],
      },
    });
    map.on("click", "project-tasks-fill", (event) => {
      if (mode !== "idle") return;
      const planId = event.features?.[0]?.properties?.planId;
      if (typeof planId === "string") [...taskHandlers].forEach((handler) => handler(planId));
    });
    map.on("mouseenter", "project-tasks-fill", () => {
      if (mode === "idle") map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "project-tasks-fill", () => {
      if (mode === "idle") map.getCanvas().style.cursor = "";
    });

    map.addSource("no-fly-zones", { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "no-fly-zones-fill",
      type: "fill",
      source: "no-fly-zones",
      paint: { "fill-color": mapColor("noFly"), "fill-opacity": 0.2 },
    });
    map.addLayer({
      id: "no-fly-zones-line",
      type: "line",
      source: "no-fly-zones",
      paint: { "line-color": mapColor("noFly"), "line-width": 2, "line-dasharray": [4, 3] },
    });

    map.addSource("plan-path", { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "plan-path-line",
      type: "line",
      source: "plan-path",
      paint: {
        "line-color": mapColor("path"),
        "line-width": 2,
        "line-opacity": 0.9,
      },
    });

    map.addSource("plan-waypoints", { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "plan-waypoints-photo",
      type: "circle",
      source: "plan-waypoints",
      paint: {
        "circle-radius": ["interpolate", ["linear"], ["zoom"], 12, 3, 18, 7],
        "circle-color": ["case", ["get", "take_photo"], mapColor("photo"), mapColor("turn")],
        "circle-opacity": 0.9,
        "circle-stroke-width": 1,
        "circle-stroke-color": mapColor("white"),
        "circle-stroke-opacity": 0.9,
      },
    });

    // A finger is wider than the dot it is aiming at.
    map.addLayer({
      id: "plan-waypoints-hit",
      type: "circle",
      source: "plan-waypoints",
      paint: { "circle-radius": 14, "circle-opacity": 0 },
    });

    map.on("click", "plan-waypoints-hit", (event) => {
      if (mode !== "idle") return;
      const feature = event.features?.[0];
      if (feature) showWaypointPopup(feature as never);
    });
    map.on("mouseenter", "plan-waypoints-hit", () => {
      if (mode === "idle") map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "plan-waypoints-hit", () => {
      if (mode === "idle") map.getCanvas().style.cursor = "";
    });

    map.addSource("plan-3d", { type: "geojson", data: emptyCollection() });
    map.addLayer({
      id: "plan-3d-posts",
      type: "fill-extrusion",
      source: "plan-3d",
      filter: ["==", ["get", "kind"], "post"],
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": mapColor("turn"),
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-height": ["get", "top"],
        "fill-extrusion-opacity": 0.6,
      },
    });
    map.addLayer({
      id: "plan-3d-caps",
      type: "fill-extrusion",
      source: "plan-3d",
      filter: ["==", ["get", "kind"], "cap"],
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": [
          "case",
          ["get", "take_photo"],
          mapColor("photo"),
          mapColor("turn"),
        ],
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-height": ["get", "top"],
      },
    });
    map.on("click", "plan-3d-caps", (event) => {
      const properties = event.features?.[0]?.properties;
      if (mode !== "idle" || !properties) return;
      const coordinates = [properties.lon, properties.lat];
      showWaypointPopup({ geometry: { coordinates }, properties });
    });
    map.on("mouseenter", "plan-3d-caps", () => {
      if (mode === "idle") map.getCanvas().style.cursor = "pointer";
    });
    map.on("mouseleave", "plan-3d-caps", () => {
      if (mode === "idle") map.getCanvas().style.cursor = "";
    });

    map.addLayer({
      id: "plan-3d-ribbon",
      type: "fill-extrusion",
      source: "plan-3d",
      filter: ["==", ["get", "kind"], "ribbon"],
      layout: { visibility: "none" },
      paint: {
        "fill-extrusion-color": ["case", ["get", "clear"], mapColor("path"), mapColor("missing")],
        "fill-extrusion-base": ["get", "base"],
        "fill-extrusion-height": ["get", "top"],
      },
    });

    if (tasks.length > 0) paintTasks();
    paintNoFlyZones();
    styleReady = true;
    applyTerrain();

    notify();
  });

  map.on("draw.create", () => {
    const all = draw.getAll();
    const polygons = all.features.filter((f) => f.geometry.type === "Polygon");
    for (const feature of polygons.slice(0, -1)) {
      if (feature.id) draw.delete(String(feature.id));
    }
    mode = "idle";
    notify();
  });
  map.on("draw.update", notify);
  map.on("draw.delete", notify);

  map.on("click", (event) => {
    if (mode !== "takeoff") return;
    setTakeoff({ lng: event.lngLat.lng, lat: event.lngLat.lat });
    mode = "idle";
    map.getCanvas().style.cursor = "";
    notify();
  });

  let waypointPopup: maplibregl.Popup | null = null;

  function showWaypointPopup(feature: {
    geometry: { coordinates: number[] };
    properties: Record<string, unknown>;
  }): void {
    const [lon, lat, alt] = feature.geometry.coordinates;
    const p = feature.properties;
    const rows: Array<[string, string]> = [
      ["Waypoint", `${Number(p.index) + 1}`],
      ["Action", p.take_photo ? "Photo" : "Turn only"],
      ["Latitude", lat.toFixed(6)],
      ["Longitude", lon.toFixed(6)],
      ["Altitude", `${Math.round(Number(p.altitude ?? alt ?? 0))} m`],
      ["Heading", `${Math.round(Number(p.heading))}°`],
      ["Gimbal", `${p.gimbal_angle}°`],
    ];
    if (p.speed !== undefined) rows.push(["Speed", `${p.speed} m/s`]);

    // Built as DOM rather than HTML, so nothing needs escaping.
    const table = document.createElement("dl");
    table.className = "waypoint-popup";
    for (const [label, value] of rows) {
      const dt = document.createElement("dt");
      dt.textContent = label;
      const dd = document.createElement("dd");
      dd.textContent = value;
      table.append(dt, dd);
    }

    waypointPopup?.remove();
    waypointPopup = new maplibregl.Popup({ closeButton: true, maxWidth: "none" })
      .setLngLat([lon, lat])
      .setDOMContent(table)
      .addTo(map);
  }

  function takeoffMarkerAt(lngLat: [number, number], className: string, title: string) {
    const element = document.createElement("div");
    element.className = className;
    element.title = title;
    return new maplibregl.Marker({ element, anchor: "center" }).setLngLat(lngLat).addTo(map);
  }

  // Without a takeoff point, the plan starts from the middle of the area, so launch there.
  function paintPlanStart() {
    planStartMarker?.remove();
    planStartMarker = null;
    if (!planStart || takeoffPoint) return;
    planStartMarker = takeoffMarkerAt(
      planStart,
      "takeoff-marker takeoff-marker-assumed",
      "No takeoff point set: the plan assumes you take off here",
    );
  }

  function setTakeoff(value: { lng: number; lat: number } | null) {
    takeoffMarker?.remove();
    takeoffMarker = null;
    takeoffPoint = value ? { lon: value.lng, lat: value.lat } : null;
    if (value) {
      takeoffMarker = takeoffMarkerAt([value.lng, value.lat], "takeoff-marker", "Takeoff point");
    }
    paintPlanStart();
  }

  // Keep the fitted area clear of the mobile sheet.
  function fitPadding(base: number) {
    const uniform = { top: base, right: base, bottom: base, left: base };
    const pane = document.querySelector<HTMLElement>("#wizard-pane");
    if (!pane || getComputedStyle(pane).position !== "fixed") return uniform;

    const mapRect = container.getBoundingClientRect();
    const overlap = Math.max(0, mapRect.bottom - pane.getBoundingClientRect().top);
    // Always leave at least a quarter of the map available to fit into.
    const bottom = base + Math.min(overlap, Math.max(0, mapRect.height * 0.75 - base));
    return { ...uniform, bottom };
  }

  // Terrain only exists alongside a plan, so the 3D view always has something to show.
  function applyTerrain(): void {
    if (!styleReady) return;
    if (planDem !== terrainDem) swapTerrainSource(planDem);
    const available = plan !== null && terrainDem !== null;
    if (!available && is3d) set3d(false);
    if (is3d) paintExtrusions();
    terrainToggle.setState({ available, on: is3d });
  }

  function swapTerrainSource(dem: DemSampler | null): void {
    if (is3d) map.setTerrain(null);
    if (map.getLayer("plan-hillshade")) map.removeLayer("plan-hillshade");
    for (const id of [TERRAIN_SOURCE, HILLSHADE_SOURCE]) {
      if (map.getSource(id)) map.removeSource(id);
    }
    terrainDem = dem;
    if (!dem) return;

    // A new URL per DEM stops MapLibre reusing tiles cached from the last one.
    terrainVersion++;
    const source = {
      type: "raster-dem" as const,
      tiles: [`${DEM_PROTOCOL}://${terrainVersion}/{z}/{x}/{y}`],
      tileSize: DEM_TILE_SIZE,
      maxzoom: DEM_MAX_ZOOM,
      encoding: "terrarium" as const,
    };
    map.addSource(TERRAIN_SOURCE, source);
    map.addSource(HILLSHADE_SOURCE, source);
    // Below the tasks and the plan, above the basemap.
    map.addLayer(
      {
        id: "plan-hillshade",
        type: "hillshade",
        source: HILLSHADE_SOURCE,
        layout: { visibility: is3d ? "visible" : "none" },
        paint: { "hillshade-exaggeration": 0.4 },
      },
      "project-tasks-fill",
    );
    if (is3d) map.setTerrain({ source: TERRAIN_SOURCE, exaggeration: 1 });
  }

  function paintExtrusions(): void {
    const source = map.getSource("plan-3d") as maplibregl.GeoJSONSource | undefined;
    const data =
      plan && terrainDem
        ? flightExtrusions(groundSampler(terrainDem), plan.waypoints, plan.path)
        : emptyCollection();
    source?.setData(data as never);
  }

  function set3d(on: boolean): void {
    is3d = on && plan !== null && terrainDem !== null;
    const shown3d = is3d ? "visible" : "none";
    const shown2d = is3d ? "none" : "visible";
    for (const id of ["plan-hillshade", "plan-3d-posts", "plan-3d-ribbon", "plan-3d-caps"]) {
      if (map.getLayer(id)) map.setLayoutProperty(id, "visibility", shown3d);
    }
    for (const id of ["plan-waypoints-photo", "plan-waypoints-hit"]) {
      map.setLayoutProperty(id, "visibility", shown2d);
    }
    map.setTerrain(is3d ? { source: TERRAIN_SOURCE, exaggeration: 1 } : null);
    paintExtrusions();
    // Without freezeElevation, MapLibre 4 keeps the camera at the elevation it read
    // before the terrain tiles loaded, which can leave it underground.
    map.easeTo({
      pitch: is3d ? PITCH_3D : 0,
      bearing: is3d ? map.getBearing() : 0,
      freezeElevation: true,
    });
    terrainToggle.setState({ available: plan !== null && terrainDem !== null, on: is3d });
  }

  function currentRing(): Array<[number, number]> | null {
    const polygon = draw.getAll().features.find((feature) => feature.geometry.type === "Polygon");
    if (!polygon || polygon.geometry.type !== "Polygon") return null;
    const ring = polygon.geometry.coordinates[0];
    if (!ring || ring.length < 4) return null;
    return ring.map(([lon, lat]) => [lon, lat] as [number, number]);
  }

  return {
    map,

    ring: currentRing,

    setRing(ring) {
      draw.deleteAll();
      draw.add({
        type: "Feature",
        properties: {},
        geometry: { type: "Polygon", coordinates: [ring] },
      });
      notify();
    },

    clearRing() {
      draw.deleteAll();
      notify();
    },

    startDrawing() {
      draw.deleteAll();
      draw.changeMode("draw_polygon");
      mode = "draw";
      notify();
    },

    setMode(next) {
      mode = next;
      map.getCanvas().style.cursor = next === "takeoff" ? "crosshair" : "";
      if (next === "draw") draw.changeMode("draw_polygon");
    },

    takeoff: () => takeoffPoint,

    setTakeoff(point) {
      setTakeoff(point ? { lng: point.lon, lat: point.lat } : null);
      notify();
    },

    showTasks(next) {
      tasks = next;
      paintTasks();
    },

    showNoFlyZones(rings) {
      noFlyZones = rings;
      paintNoFlyZones();
    },

    onTaskClick(handler) {
      taskHandlers.add(handler);
      return () => taskHandlers.delete(handler);
    },

    showPlan(waypoints, path, dem = null) {
      const pathSource = map.getSource("plan-path") as maplibregl.GeoJSONSource | undefined;
      const wpSource = map.getSource("plan-waypoints") as maplibregl.GeoJSONSource | undefined;
      pathSource?.setData((path ?? emptyCollection()) as never);
      wpSource?.setData((waypoints ?? emptyCollection()) as never);
      document.documentElement.dataset.plan = waypoints ? "yes" : "no";
      const start = path?.features[0]?.geometry.coordinates[0];
      planStart = start ? [start[0], start[1]] : null;
      paintPlanStart();

      // Editing the area under a finished plan silently invalidates it, so the
      // AOI is locked for exactly as long as a plan is displayed.
      if (!waypoints) waypointPopup?.remove();
      plan = waypoints && path ? { waypoints, path } : null;
      planDem = plan ? dem : null;
      applyTerrain();

      const wanted = waypoints ? "static" : "simple_select";
      if (draw.getMode() !== wanted) draw.changeMode(wanted as never);
    },

    fitBbox(bbox, padding = 40) {
      const bounds: LngLatBoundsLike = [
        [bbox[0], bbox[1]],
        [bbox[2], bbox[3]],
      ];
      map.fitBounds(bounds, { padding: fitPadding(padding), duration: 600, maxZoom: 17 });
    },

    onChange(handler) {
      changeHandlers.add(handler);
      return () => changeHandlers.delete(handler);
    },

    locate() {
      return new Promise((resolve, reject) => {
        if (!navigator.geolocation) {
          reject(new Error("This browser cannot report your location."));
          return;
        }
        navigator.geolocation.getCurrentPosition(
          (position) => resolve({ lon: position.coords.longitude, lat: position.coords.latitude }),
          (error) =>
            reject(
              new Error(
                error.code === error.PERMISSION_DENIED
                  ? "Location permission was refused. Tap the map to set takeoff instead."
                  : "Could not get your location. Tap the map to set takeoff instead.",
              ),
            ),
          { enableHighAccuracy: true, timeout: 10_000 },
        );
      });
    },
  };
}
