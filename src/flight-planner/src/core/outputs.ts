import { createKmz, createPotensicZip, createWpml, outputFormatFor } from "./qfield";
import { binaryEntry, buildBinaryZip, textEntry, type ZipEntry } from "./zip";
import type { PlanResult } from "./flightplan";
import type { PlanParams } from "./flightplan";
import type { PlanMeta } from "./storage";
import { formatArea } from "./aoi";
import { bboxSizeKm, type Bbox } from "./dem";

export interface OutputFile {
  name: string;
  data: string | ArrayBuffer;
  mime: string;
  label: string;
  hint: string;
}

function stamp(): string {
  return new Date().toISOString().replace(/[:.]/g, "-").slice(0, 19);
}

export function planLabel(meta: PlanMeta): string {
  if (meta.name) return meta.name;
  if (meta.taskId) return `Task ${meta.taskId}`;
  const started = new Date(meta.createdAt);
  if (Number.isNaN(started.getTime())) return "Untitled plan";
  const day = started.toLocaleDateString(undefined, { day: "numeric", month: "short" });
  return meta.areaM2 ? `${day} · ${formatArea(meta.areaM2)}` : day;
}

export function baseName(meta: PlanMeta): string {
  const scope = meta.taskId ? `task_${meta.taskId}` : meta.name || "flightplan";
  return `${scope.replace(/[^\w.-]+/g, "_")}_${stamp()}`;
}

export function buildOutputs(result: PlanResult, params: PlanParams, meta: PlanMeta): OutputFile[] {
  const base = baseName(meta);
  const files: OutputFile[] = [];

  if (outputFormatFor(params.droneType) === "potensic") {
    const bundle = createPotensicZip(result.waypoints, result.parameters.ground_speed);
    files.push({
      name: `${base}_potensic.zip`,
      data: bundle.zipData,
      mime: "application/zip",
      label: "Potensic mission (.zip)",
      hint: "Unzip onto the controller's storage, then pick the mission in the app.",
    });
  } else {
    const first = result.waypoints.features[0]?.geometry.coordinates;
    const globalHeight = first && first.length > 2 ? (first[2] as number) : 100;
    const wpml = createWpml(result.waypoints, globalHeight);
    files.push({
      name: `${base}.kmz`,
      data: createKmz(wpml),
      mime: "application/vnd.google-earth.kmz",
      label: "DJI mission (.kmz)",
      hint: "Copy to the controller, then import it in DJI Fly or Pilot.",
    });
    files.push({
      name: `${base}.wpml`,
      data: wpml,
      mime: "application/xml",
      label: "DJI waypoints (.wpml)",
      hint: "The raw mission XML, in case you need to inspect or edit it.",
    });
  }

  files.push({
    name: `${base}.geojson`,
    data: JSON.stringify(result.waypoints, null, 2),
    mime: "application/geo+json",
    label: "Waypoints (.geojson)",
    hint: "Open in QGIS or any GIS to check the plan before you fly.",
  });

  files.push({
    name: `${base}_flightpath.geojson`,
    data: JSON.stringify(result.flightpath, null, 2),
    mime: "application/geo+json",
    label: "Flight path (.geojson)",
    hint: "The route as a single line, for a quick visual check.",
  });

  return files;
}

/** Packages a plan and its terrain crop for offline recovery. */
export function buildPlanBundle(
  meta: PlanMeta,
  aoi: unknown,
  params: PlanParams,
  outputs: OutputFile[],
  demBytes?: ArrayBuffer | null,
): ArrayBuffer {
  const entries: ZipEntry[] = [
    textEntry("meta.json", JSON.stringify(meta, null, 2)),
    textEntry("aoi.geojson", JSON.stringify(aoi, null, 2)),
    textEntry("params.json", JSON.stringify(params, null, 2)),
  ];

  for (const file of outputs) {
    entries.push(
      typeof file.data === "string"
        ? textEntry(file.name, file.data)
        : binaryEntry(file.name, file.data),
    );
  }

  if (demBytes) entries.push(binaryEntry("dem.tif", demBytes));

  entries.push(
    textEntry(
      "README.txt",
      "DroneTM flight plan bundle\n" +
        "==========================\n\n" +
        `Plan:      ${planLabel(meta)}\n` +
        `Created:   ${meta.createdAt}\n` +
        `DEM:       ${meta.dem ? `${meta.dem.source}, ${meta.dem.width}x${meta.dem.height} px` : "none"}\n\n` +
        "aoi.geojson    the flight area\n" +
        "params.json    the flight parameters, re-uploadable to plan.drone.hotosm.org\n" +
        "dem.tif        the terrain the altitudes were sampled from, cropped to this area\n" +
        "*.geojson      the generated waypoints and flight path\n" +
        "*.kmz / *.wpml the mission files for the controller\n",
    ),
  );

  return buildBinaryZip(entries);
}

export function download(file: OutputFile): void {
  const blob = new Blob([file.data], { type: file.mime });
  const url = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = url;
  anchor.download = file.name;
  anchor.rel = "noopener";
  document.body.append(anchor);
  anchor.click();
  anchor.remove();
  setTimeout(() => URL.revokeObjectURL(url), 30_000);
}

export function byteSize(data: string | ArrayBuffer): number {
  return typeof data === "string" ? new TextEncoder().encode(data).byteLength : data.byteLength;
}

export function formatBytes(bytes: number): string {
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

export function formatExtent(bbox: Bbox): string {
  const round = (km: number) => (km < 10 ? km.toFixed(1) : String(Math.round(km)));
  const { widthKm, heightKm } = bboxSizeKm(bbox);
  return `${round(widthKm)} x ${round(heightKm)} km`;
}
