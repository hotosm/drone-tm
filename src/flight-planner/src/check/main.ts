// Offline photo check for one task. Reads local files, stores and uploads nothing.

import "@hotosm/ui/dist/style.css";
import "@hotosm/ui/dist/webawesome-all.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/app.css";

import maplibregl, { type GeoJSONSource, type LngLatBoundsLike } from "maplibre-gl";
import { singlePolygonRing, validateRing } from "../core/aoi";
import { assessCoverage, type Coverage } from "../core/photo-coverage";
import { geojsonLine, readPlanFile } from "../core/plan-file";
import { readPhoto, type PhotoInfo } from "../core/photos";
import { BasemapToggle, basemapStyle } from "../map/basemap";
import { mapColor } from "../map/palette";
import {
  busyNote,
  errorPanel,
  escapeHtml,
  infoPanel,
  successPanel,
  warningPanel,
} from "../steps/ui";

type LonLat = [number, number];

interface CheckState {
  area: LonLat[] | null;
  plan: LonLat[];
  photos: PhotoInfo[];
  /** Keyed by relative path: DJI restarts file names in each folder. */
  files: Map<string, File>;
  noGpsCount: number;
  unreadable: string[];
}

function emptyState(): CheckState {
  return { area: null, plan: [], photos: [], files: new Map(), noGpsCount: 0, unreadable: [] };
}

let state = emptyState();
let popup: maplibregl.Popup | null = null;
const statusHost = document.querySelector<HTMLElement>("#check-status")!;
const filesInput = document.querySelector<HTMLInputElement>("#files-input")!;
const folderInput = document.querySelector<HTMLInputElement>("#folder-input")!;

const map = new maplibregl.Map({
  container: "map",
  style: basemapStyle(),
  center: [0, 20],
  zoom: 2,
  attributionControl: { compact: true },
});
map.addControl(new BasemapToggle(), "top-right");
map.addControl(new maplibregl.NavigationControl({ showCompass: false }), "top-right");
map.addControl(new maplibregl.ScaleControl({ unit: "metric" }), "bottom-left");

map.on("load", () => {
  for (const id of ["cells", "area", "plan", "photos"]) {
    map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  map.addLayer({
    id: "cells",
    type: "fill",
    source: "cells",
    paint: {
      "fill-color": [
        "match",
        ["get", "status"],
        "missing",
        mapColor("missing"),
        "low",
        mapColor("low"),
        mapColor("ok"),
      ],
      "fill-opacity": 0.45,
    },
  });
  map.addLayer({
    id: "area",
    type: "line",
    source: "area",
    paint: { "line-color": mapColor("task"), "line-width": 2 },
  });
  map.addLayer({
    id: "plan",
    type: "line",
    source: "plan",
    paint: { "line-color": mapColor("path"), "line-width": 1, "line-dasharray": [2, 2] },
  });
  map.addLayer({
    id: "photos",
    type: "circle",
    source: "photos",
    paint: {
      "circle-radius": 3,
      "circle-color": mapColor("photo"),
      "circle-stroke-color": mapColor("white"),
      "circle-stroke-width": 1,
    },
  });
});

function setData(id: string, features: GeoJSON.Feature[]): void {
  const source = map.getSource(id) as GeoJSONSource | undefined;
  source?.setData({ type: "FeatureCollection", features });
}

function feature(geometry: GeoJSON.Geometry, properties = {}): GeoJSON.Feature {
  return { type: "Feature", geometry, properties };
}

function percent(share: number): string {
  return `${Math.round(share * 100)}%`;
}

function statusPanel(coverage: Coverage | null): string {
  const unreadable = state.unreadable.length
    ? `${state.unreadable.length} unreadable (${state.unreadable.slice(0, 3).join(", ")})`
    : "";
  if (!state.area) {
    return infoPanel(
      "Add the task area to get a verdict.",
      `Download it as GeoJSON from the task page in DroneTM. ${unreadable}`,
    );
  }

  const notes = [
    `${state.photos.length} photos placed`,
    state.noGpsCount && `${state.noGpsCount} without GPS`,
    unreadable,
    coverage?.outsideCount && `${coverage.outsideCount} outside the task`,
    coverage?.unsizedCount && `${coverage.unsizedCount} without height or lens data`,
  ].filter(Boolean);
  const read = `${notes.join(", ")}.`;

  if (!coverage) {
    if (notes.length === 1) return infoPanel("Add the photos from the SD card.");
    return warningPanel("No photos could be placed on the map.", read);
  }
  if (coverage.verdict === "unknown") {
    return warningPanel(
      "Coverage unavailable.",
      `The photos have no height or lens data, so their footprints are unknown. Check the photo points by eye. ${read}`,
    );
  }

  const detail = `${percent(coverage.missingShare)} of the area has no photos, ${percent(coverage.lowShare)} has low overlap. ${read}`;
  if (coverage.verdict === "good") return successPanel("No obvious coverage gaps.", detail);
  if (coverage.verdict === "refly") return errorPanel("Refly this task.", detail);
  return warningPanel("Check the red and amber gaps.", detail);
}

function render(): void {
  const coverage =
    state.area && state.photos.length > 0 ? assessCoverage(state.area, state.photos) : null;
  setData(
    "cells",
    (coverage?.cells ?? []).map((cell) =>
      feature({ type: "Polygon", coordinates: [cell.ring] }, { status: cell.status }),
    ),
  );
  setData("area", state.area ? [feature({ type: "Polygon", coordinates: [state.area] })] : []);
  setData(
    "plan",
    state.plan.length ? [feature({ type: "LineString", coordinates: state.plan })] : [],
  );
  setData(
    "photos",
    state.photos.map((photo) =>
      feature({ type: "Point", coordinates: [photo.lon, photo.lat] }, photo),
    ),
  );
  statusHost.innerHTML = statusPanel(coverage);
}

function fitToData(): void {
  const points = [
    ...(state.area ?? []),
    ...state.plan,
    ...state.photos.map((photo): LonLat => [photo.lon, photo.lat]),
  ];
  if (points.length === 0) return;
  const lons = points.map(([lon]) => lon);
  const lats = points.map(([, lat]) => lat);
  const bounds: LngLatBoundsLike = [
    [Math.min(...lons), Math.min(...lats)],
    [Math.max(...lons), Math.max(...lats)],
  ];
  map.fitBounds(bounds, { padding: 60, maxZoom: 18, duration: 0 });
}

async function addFile(target: CheckState, file: File): Promise<void> {
  const name = file.name.toLowerCase();
  if (/\.jpe?g$/.test(name)) {
    const key = file.webkitRelativePath || file.name;
    if (target.files.has(key)) return;
    const photo = await readPhoto(file);
    if (!photo) {
      target.noGpsCount++;
      return;
    }
    target.photos.push({ ...photo, name: key });
    target.files.set(key, file);
    return;
  }
  if (/\.(kmz|wpml)$/.test(name)) {
    target.plan = await readPlanFile(file);
    return;
  }
  if (/\.(geo)?json$/.test(name)) {
    const geojson: unknown = JSON.parse(await file.text());
    const ring = singlePolygonRing(geojson);
    if (ring) target.area = validateRing(ring).ring;
    else target.plan = geojsonLine(geojson);
  }
}

async function addFiles(files: File[]): Promise<void> {
  // Next task replaces state, which cancels this import.
  const target = state;
  statusHost.innerHTML = busyNote(`Reading ${files.length} files…`);
  for (const file of files) {
    try {
      await addFile(target, file);
    } catch {
      target.unreadable.push(file.name);
    }
    if (state !== target) return;
  }
  render();
  fitToData();
}

map.on("click", "photos", (event) => {
  const photo = event.features?.[0]?.properties as PhotoInfo | undefined;
  const file = photo && state.files.get(photo.name);
  if (!photo || !file) return;
  const url = URL.createObjectURL(file);
  const height = photo.heightM === null ? "unknown" : `${Math.round(photo.heightM)} m`;
  popup = new maplibregl.Popup({ maxWidth: "20rem" })
    .setLngLat(event.lngLat)
    .setHTML(
      `<img src="${url}" alt="" style="width: 100%" />
       <p><strong>${escapeHtml(photo.name)}</strong><br />${escapeHtml(photo.takenAt)}, ${height} above takeoff</p>`,
    )
    .on("close", () => URL.revokeObjectURL(url))
    .addTo(map);
});

map.on("mouseenter", "photos", () => (map.getCanvas().style.cursor = "pointer"));
map.on("mouseleave", "photos", () => (map.getCanvas().style.cursor = ""));

for (const input of [filesInput, folderInput]) {
  input.addEventListener("change", () => {
    void addFiles([...(input.files ?? [])]);
    input.value = "";
  });
}
document.querySelector("#add-files")!.addEventListener("click", () => filesInput.click());
document.querySelector("#add-folder")!.addEventListener("click", () => folderInput.click());
document.querySelector("#next-task")!.addEventListener("click", () => {
  popup?.remove();
  state = emptyState();
  render();
});

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();
  void addFiles([...(event.dataTransfer?.files ?? [])]);
});

map.once("load", render);
