// Offline photo check for one task. Reads local files, stores and uploads nothing.

import "@hotosm/ui/dist/style.css";
import "@hotosm/ui/dist/webawesome-all.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "../styles/app.css";

import maplibregl, { type GeoJSONSource } from "maplibre-gl";
import { taskAreas, type TaskArea } from "../core/aoi";
import { assessCoverage, matchTask, type Coverage, type TaskMatch } from "../core/photo-coverage";
import { readPhoto, type PhotoInfo } from "../core/photos";
import { BasemapToggle, basemapStyle } from "../map/basemap";
import { mapColor } from "../map/palette";
import {
  busyNote,
  errorPanel,
  escapeHtml,
  infoPanel,
  stat,
  successPanel,
  warningPanel,
} from "../steps/ui";

type LonLat = [number, number];

interface CheckState {
  tasks: TaskArea[];
  skippedTasks: Array<number | null>;
  photos: PhotoInfo[];
  /** DJI repeats file names across folders. */
  files: Map<string, File>;
  noGpsCount: number;
  unreadable: string[];
}

function emptyState(): CheckState {
  return {
    tasks: [],
    skippedTasks: [],
    photos: [],
    files: new Map(),
    noGpsCount: 0,
    unreadable: [],
  };
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
  for (const id of ["cells", "buffer", "tasks", "area", "gaps", "photos"]) {
    map.addSource(id, { type: "geojson", data: { type: "FeatureCollection", features: [] } });
  }
  map.addLayer({
    id: "cells",
    type: "fill",
    source: "cells",
    paint: {
      "fill-color": ["match", ["get", "status"], "missing", mapColor("missing"), mapColor("ok")],
      "fill-opacity": ["case", ["get", "inBuffer"], 0.25, 0.45],
    },
  });
  map.addLayer({
    id: "buffer",
    type: "line",
    source: "buffer",
    paint: { "line-color": mapColor("buffer"), "line-width": 2, "line-dasharray": [2, 2] },
  });
  map.addLayer({
    id: "tasks",
    type: "line",
    source: "tasks",
    paint: {
      "line-color": mapColor("task"),
      "line-width": 1.5,
      "line-opacity": 0.8,
      "line-dasharray": [3, 2],
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
    type: "circle",
    source: "gaps",
    paint: {
      "circle-radius": 5,
      "circle-color": mapColor("gap"),
      "circle-stroke-color": mapColor("white"),
      "circle-stroke-width": 1,
    },
  });
  map.addLayer({
    id: "photos",
    type: "circle",
    source: "photos",
    paint: {
      "circle-radius": 4.5,
      "circle-color": mapColor("path"),
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

function plural(count: number, word: string): string {
  return `${count} ${word}${count === 1 ? "" : "s"}`;
}

function verdictPanel(coverage: Coverage): string {
  const gaps = coverage.gaps ?? [];
  const missedCount = gaps.reduce((sum, gap) => sum + gap.missed.length, 0);
  const uncovered =
    coverage.missingShare > 0
      ? `${percent(coverage.missingShare)} of the task has no photo close enough to map it.`
      : "";
  const inBuffer = coverage.bufferMissedCount
    ? `${coverage.bufferMissedCount} of them in the overlap buffer, which neighbouring tasks need.`
    : "";
  const missing = `About ${plural(missedCount, "photo")} missing.`;
  const detail = [inBuffer, "Amber points mark where they should be.", uncovered]
    .filter(Boolean)
    .join(" ");

  const unchecked =
    "Missing photos could not be checked. That needs capture times and at least two regular flight lines.";
  if (!coverage.gaps && coverage.verdict === "refly") {
    return errorPanel("Refly this task.", `${uncovered} ${unchecked}`);
  }
  if (!coverage.gaps) return warningPanel("Missing photos could not be checked.", uncovered);
  if (coverage.verdict === "good") {
    return successPanel("No missing photos found.", "Every part of the task is covered.");
  }
  if (coverage.verdict === "refly") return errorPanel("Refly this task.", `${missing} ${detail}`);
  if (missedCount === 0) return warningPanel("Part of the task has no photos.", uncovered);
  return warningPanel(missing, detail);
}

function photoStats(coverage: Coverage): string {
  const outside = coverage.bufferCount + coverage.outsideCount;
  const missedCount = (coverage.gaps ?? []).reduce((sum, gap) => sum + gap.missed.length, 0);
  return `
    <div class="stat-row">
      ${stat("In the task", String(state.photos.length - outside))}
      ${coverage.buffer ? stat("Overlap buffer", String(coverage.bufferCount)) : ""}
      ${stat("Outside", String(coverage.outsideCount))}
      ${stat("Missing", coverage.gaps ? `~${missedCount}` : "?")}
    </div>`;
}

function taskName(id: number | null): string {
  return id === null ? "an unnumbered task" : `task ${id}`;
}

function statusPanel(match: TaskMatch, coverage: Coverage | null): string {
  const unreadable = state.unreadable.length
    ? `${state.unreadable.length} unreadable (${state.unreadable.slice(0, 3).join(", ")})`
    : "";
  if (state.tasks.length === 0) {
    return infoPanel(
      "Add the task area to verify.",
      `Download it as GeoJSON from the task page in DroneTM, or all tasks from the project Export. ${unreadable}`,
    );
  }
  if (!match.task && state.photos.length > 0) {
    return warningPanel("None of the photos fall inside the task areas.", unreadable);
  }
  if (match.task && match.mixedWith.length > 0) {
    const tasks = [match.task, ...match.mixedWith].map((task) => taskName(task.id)).join(", ");
    return warningPanel(
      `These photos span ${tasks}.`,
      "Clear and add one task's photos at a time to check coverage.",
    );
  }

  const skipped = [
    state.noGpsCount && `${plural(state.noGpsCount, "photo")} without GPS`,
    unreadable,
    coverage?.unsizedCount &&
      `${plural(coverage.unsizedCount, "photo")} without height or lens data`,
  ].filter(Boolean);
  const notes = skipped.length
    ? `<p class="muted">Skipped: ${escapeHtml(skipped.join(", "))}.</p>`
    : "";

  if (!coverage) {
    if (!notes) return infoPanel("Add the photos from the SD card.");
    return warningPanel("No photos could be placed on the map.") + notes;
  }
  if (coverage.verdict === "unknown") {
    return (
      warningPanel(
        "Coverage unavailable.",
        "The photos have no height or lens data, so their footprints are unknown. Check the photo points by eye.",
      ) + notes
    );
  }
  return verdictPanel(coverage) + photoStats(coverage) + notes;
}

function render(): TaskMatch {
  const match = matchTask(state.tasks, state.photos);
  const area = match.task?.ring ?? null;
  // Another task's photos break the flight-line tracing, which can hide real gaps.
  const checkable = area && state.photos.length > 0 && match.mixedWith.length === 0;
  const coverage = checkable ? assessCoverage(area, state.photos) : null;
  setData(
    "cells",
    (coverage?.cells ?? []).map((cell) =>
      feature(
        { type: "Polygon", coordinates: [cell.ring] },
        { status: cell.status, inBuffer: cell.inBuffer },
      ),
    ),
  );
  setData(
    "tasks",
    state.tasks.map((task) => feature({ type: "Polygon", coordinates: [task.ring] })),
  );
  setData("area", area ? [feature({ type: "Polygon", coordinates: [area] })] : []);
  setData(
    "buffer",
    coverage?.buffer ? [feature({ type: "LineString", coordinates: coverage.buffer })] : [],
  );
  setData(
    "gaps",
    (coverage?.gaps ?? []).flatMap((gap) =>
      gap.missed.map((position) => feature({ type: "Point", coordinates: position })),
    ),
  );
  setData(
    "photos",
    state.photos.map((photo) =>
      feature({ type: "Point", coordinates: [photo.lon, photo.lat] }, photo),
    ),
  );
  statusHost.innerHTML = statusPanel(match, coverage);
  photosSummary.textContent = state.photos.length ? `${state.photos.length} placed` : "";
  areaSummary.textContent = areaSummaryText(match);
  return match;
}

/** A project export stays loaded between tasks, and may have skipped tasks to report. */
function isProjectExport(): boolean {
  return state.tasks.length + state.skippedTasks.length > 1;
}

function areaSummaryText(match: TaskMatch): string {
  if (state.tasks.length === 0) return "Needed (.geojson from the task or project page)";
  if (!isProjectExport()) return "Added";
  const skippedNames = state.skippedTasks.map(taskName).join(", ");
  const skipped = skippedNames ? `. Skipped ${skippedNames}: shape not supported` : "";
  const count = `${state.tasks.length} tasks${skipped}`;
  return match.task ? `Checking ${taskName(match.task.id)} of ${count}` : count;
}

function fitToData({ task }: TaskMatch): void {
  const points = [
    ...(task?.ring ?? state.tasks.flatMap((other) => other.ring)),
    ...state.photos.map((photo): LonLat => [photo.lon, photo.lat]),
  ];
  if (points.length === 0) return;
  const bounds = new maplibregl.LngLatBounds(points[0], points[0]);
  for (const point of points) bounds.extend(point);
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
    const { tasks, skipped } = taskAreas(JSON.parse(await file.text()));
    if (tasks.length === 0) throw new Error("No task polygons.");
    target.tasks = tasks;
    target.skippedTasks = skipped;
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
  fitToData(render());
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
  const { tasks, skippedTasks } = state;
  state = isProjectExport() ? { ...emptyState(), tasks, skippedTasks } : emptyState();
  render();
});

document.addEventListener("dragover", (event) => event.preventDefault());
document.addEventListener("drop", (event) => {
  event.preventDefault();
  void addFiles([...(event.dataTransfer?.files ?? [])]);
});

map.once("load", render);
