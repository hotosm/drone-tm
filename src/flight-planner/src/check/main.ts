// Offline photo check for one task. Reads local files, stores and uploads nothing.

import "@hotosm/ui/dist/style.css";
import "@hotosm/ui/dist/webawesome-all.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/app.css";

import maplibregl, { type GeoJSONSource, type LngLatBoundsLike } from "maplibre-gl";
import { singlePolygonRing, validateRing } from "../core/aoi";
import { assessCoverage, type Coverage } from "../core/photo-coverage";
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
  photos: PhotoInfo[];
  /** DJI repeats file names across folders. */
  files: Map<string, File>;
  noGpsCount: number;
  unreadable: string[];
}

function emptyState(): CheckState {
  return { area: null, photos: [], files: new Map(), noGpsCount: 0, unreadable: [] };
}

let state = emptyState();
let popup: maplibregl.Popup | null = null;
const statusHost = document.querySelector<HTMLElement>("#check-status")!;
const photosSummary = document.querySelector<HTMLElement>("#photos-summary")!;
const areaSummary = document.querySelector<HTMLElement>("#area-summary")!;

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
  for (const id of ["cells", "area", "gaps", "photos"]) {
    map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  map.addLayer({
    id: "cells",
    type: "fill",
    source: "cells",
    paint: {
      "fill-color": ["match", ["get", "status"], "missing", mapColor("missing"), mapColor("ok")],
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
    id: "gaps",
    type: "line",
    source: "gaps",
    paint: { "line-color": mapColor("gap"), "line-width": 4 },
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

/** Rounds up so a small hole never reads as 0%. */
function percent(share: number): string {
  return `${Math.ceil(share * 100)}%`;
}

function statusPanel(coverage: Coverage | null): string {
  const unreadable = state.unreadable.length
    ? `${state.unreadable.length} unreadable (${state.unreadable.slice(0, 3).join(", ")})`
    : "";
  if (!state.area) {
    return infoPanel(
      "Add the task area to verify.",
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

  const missedCount = coverage.gaps.reduce((sum, gap) => sum + gap.missedCount, 0);
  const findings = [
    coverage.missingShare > 0 && `${percent(coverage.missingShare)} of the area has no photos.`,
    missedCount > 0 &&
      `About ${missedCount} photos missed in ${coverage.gaps.length} places along the flight lines.`,
  ].filter(Boolean);
  const detail = [...findings, read].join(" ");
  if (coverage.verdict === "good") return successPanel("No gaps found.", detail);
  if (coverage.verdict === "refly") return errorPanel("Refly this task.", detail);
  return warningPanel("Check the red areas and amber lines.", detail);
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
    "gaps",
    (coverage?.gaps ?? []).map(({ from, to }) =>
      feature({
        type: "LineString",
        coordinates: [
          [from.lon, from.lat],
          [to.lon, to.lat],
        ],
      }),
    ),
  );
  setData(
    "photos",
    state.photos.map((photo) =>
      feature({ type: "Point", coordinates: [photo.lon, photo.lat] }, photo),
    ),
  );
  statusHost.innerHTML = statusPanel(coverage);
  photosSummary.textContent = state.photos.length ? `${state.photos.length} placed` : "";
  areaSummary.textContent = state.area ? "Added" : "Needed (.geojson from the task page)";
}

function fitToData(): void {
  const points = [
    ...(state.area ?? []),
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
    const key = `${file.name}|${file.size}|${file.lastModified}`;
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
  if (/\.(geo)?json$/.test(name)) {
    const ring = singlePolygonRing(JSON.parse(await file.text()));
    if (!ring) throw new Error("Not a single task polygon.");
    target.area = validateRing(ring).ring;
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
       <p><strong>${escapeHtml(file.name)}</strong><br />${escapeHtml(photo.takenAt)}, ${height} above takeoff</p>`,
    )
    .on("close", () => URL.revokeObjectURL(url))
    .addTo(map);
});

map.on("mouseenter", "photos", () => (map.getCanvas().style.cursor = "pointer"));
map.on("mouseleave", "photos", () => (map.getCanvas().style.cursor = ""));

for (const button of document.querySelectorAll<HTMLElement>("[data-input]")) {
  const input = document.querySelector<HTMLInputElement>(`#${button.dataset.input}`)!;
  button.addEventListener("click", () => input.click());
  input.addEventListener("change", () => {
    void addFiles([...(input.files ?? [])]);
    input.value = "";
  });
}
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
