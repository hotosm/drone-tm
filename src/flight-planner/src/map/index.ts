import maplibregl, { type Map as MlMap, type LngLatBoundsLike } from "maplibre-gl";
import MapboxDraw from "@mapbox/mapbox-gl-draw";
import type { Bbox } from "../core/dem";
import type { FlightpathCollection, WaypointCollection } from "../core/types";
import { drawStyles } from "./draw-styles";
import { mapColor } from "./palette";

const OSM_TILES = "https://tile.openstreetmap.org/{z}/{x}/{y}.png";

export type DrawMode = "draw" | "takeoff" | "idle";

export interface MapController {
  map: MlMap;
  ring(): Array<[number, number]> | null;
  setRing(ring: Array<[number, number]>): void;
  clearRing(): void;
  startDrawing(): void;
  setMode(mode: DrawMode): void;
  takeoff(): { lon: number; lat: number } | null;
  setTakeoff(point: { lon: number; lat: number } | null): void;
  showPlan(waypoints: WaypointCollection | null, path: FlightpathCollection | null): void;
  fitBbox(bbox: Bbox, padding?: number): void;
  onChange(handler: () => void): () => void;
  locate(): Promise<{ lon: number; lat: number }>;
}

function emptyCollection() {
  return { type: "FeatureCollection" as const, features: [] };
}

export function createMap(container: HTMLElement): MapController {
  const map = new maplibregl.Map({
    container,
    style: {
      version: 8,
      sources: {
        osm: {
          type: "raster",
          tiles: [OSM_TILES],
          tileSize: 256,
          maxzoom: 19,
          attribution: "© OpenStreetMap contributors",
        },
      },
      layers: [{ id: "osm", type: "raster", source: "osm" }],
    },
    center: [0, 20],
    zoom: 2,
    attributionControl: { compact: true },
  });

  map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
  map.addControl(
    new maplibregl.GeolocateControl({
      positionOptions: { enableHighAccuracy: true },
      trackUserLocation: true,
      showUserLocation: true,
    }),
    "top-right",
  );
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
  let mode: DrawMode = "idle";
  const changeHandlers = new Set<() => void>();

  const notify = () => [...changeHandlers].forEach((handler) => handler());

  map.on("load", () => {
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

  function setTakeoff(value: { lng: number; lat: number } | null) {
    takeoffMarker?.remove();
    takeoffMarker = null;
    takeoffPoint = value ? { lon: value.lng, lat: value.lat } : null;
    if (!value) return;

    const element = document.createElement("div");
    element.className = "takeoff-marker";
    element.title = "Takeoff point";
    takeoffMarker = new maplibregl.Marker({ element, anchor: "center" })
      .setLngLat([value.lng, value.lat])
      .addTo(map);
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

    showPlan(waypoints, path) {
      const pathSource = map.getSource("plan-path") as maplibregl.GeoJSONSource | undefined;
      const wpSource = map.getSource("plan-waypoints") as maplibregl.GeoJSONSource | undefined;
      pathSource?.setData((path ?? emptyCollection()) as never);
      wpSource?.setData((waypoints ?? emptyCollection()) as never);
      document.documentElement.dataset.plan = waypoints ? "yes" : "no";

      // Editing the area under a finished plan silently invalidates it, so the
      // AOI is locked for exactly as long as a plan is displayed.
      if (!waypoints) waypointPopup?.remove();
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
