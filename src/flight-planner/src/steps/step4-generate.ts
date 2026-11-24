import type { AppState, Step } from "../app";
import { checklistCard, mountChecklistCard, promptSiteChecks } from "../checklist";
import { bboxIncludingPoint } from "../core/dem";
import { cropForBundle } from "../core/geotiff-write";
import { batteryBudget, buildPlan, type PlanParams } from "../core/flightplan";
import { DRONE_CHOICES } from "../core/qfield";
import {
  buildOutputs,
  buildPlanBundle,
  POTENSIC_EVE_MAX_WAYPOINTS,
  byteSize,
  planLabel,
  download,
  formatBytes,
  type OutputFile,
} from "../core/outputs";
import type { PlanDem } from "../core/storage";
import type { DroneTypeKey, PotensicAppKey } from "../core/types";
import { potensicAppForDrone } from "../core/params";
import { coachLead } from "../tutorial";
import { errorPanel, escapeHtml, infoPanel, option } from "./ui";

let outputs: OutputFile[] = [];

function bundleTerrain(state: AppState): { bytes: ArrayBuffer | null; dem?: PlanDem } {
  const { aoi, dem, params, meta } = state;
  if (!aoi || !dem.sampler || !dem.bytes) return { bytes: null };

  const required = bboxIncludingPoint(aoi.bbox, params.takeoffPoint);
  try {
    const crop = cropForBundle(dem.sampler, required, dem.bytes.byteLength);
    if (!crop) return { bytes: dem.bytes };
    return {
      bytes: crop.bytes,
      dem: meta.dem
        ? {
            ...meta.dem,
            bbox: crop.bbox,
            width: crop.width,
            height: crop.height,
            byteLength: crop.bytes.byteLength,
          }
        : undefined,
    };
  } catch {
    // Never lose the bundle over the crop; the full DEM is always valid.
    return { bytes: dem.bytes };
  }
}

function droneLabel(key: string): string {
  return DRONE_CHOICES.find((choice) => choice.value === key)?.label ?? key;
}

// Drone and takeoff often change per flight, so they can be changed right here.
function flightSetup(params: PlanParams): string {
  const takeoff = params.takeoffPoint
    ? `${params.takeoffPoint.lat.toFixed(5)}, ${params.takeoffPoint.lon.toFixed(5)}`
    : "Not set. Take off at the green ring, in the middle of the area.";
  const potensicApp =
    params.droneType === "POTENSIC_ATOM_2"
      ? `<wa-select id="potensic-app" label="Potensic app" value="${escapeHtml(params.potensicApp)}">
        ${option("android", "Potensic (Android)", params.potensicApp === "android")}
        ${option("eve", "Potensic Eve (iOS)", params.potensicApp === "eve")}
      </wa-select>`
      : "";
  return `
    <wa-select id="drone-type" label="Drone" value="${escapeHtml(params.droneType)}">
      ${DRONE_CHOICES.map((c) => option(c.value, c.label, c.value === params.droneType)).join("")}
    </wa-select>
    ${potensicApp}
    <div class="downloads">
      <div class="download-row">
        <div class="download-meta">
          <strong>Takeoff point</strong>
          <span class="muted">${takeoff}</span>
        </div>
        <wa-button id="change-takeoff" appearance="outlined" size="s">Change</wa-button>
      </div>
    </div>`;
}

function minutes(value: number): string {
  if (value < 1) return "under a minute";
  const whole = Math.floor(value);
  const secs = Math.round((value - whole) * 60);
  return secs >= 30 ? `${whole + 1} min` : `${whole} min`;
}

// The first output is the mission for this drone. The rest are for checking or editing it.
function downloadRow(file: OutputFile, index: number): string {
  const disabled = file.disabled ? "disabled" : "";
  return `
    <div class="download-row">
      <div class="download-meta">
        <strong>${escapeHtml(file.label)}</strong>
        <span class="muted">${escapeHtml(file.hint)}</span>
      </div>
      <wa-button data-download="${index}" appearance="outlined" size="s" ${disabled}>
        <wa-icon slot="start" name="download"></wa-icon>
        ${escapeHtml(formatBytes(byteSize(file.data)))}
      </wa-button>
    </div>`;
}

export const step4: Step = {
  key: "generate",
  label: "Generate",

  blocker(state) {
    if (!state.aoi) return "Mark a flight area first.";
    if (!state.dem.sampler && !state.dem.skipped)
      return "Get the terrain first, or choose to skip it.";
    return null;
  },

  render(ctx) {
    const { aoi, params, dem, result } = ctx.state;
    if (!aoi) return infoPanel("Mark a flight area first.");

    if (!result) {
      return `
        ${coachLead("generate")}
        ${flightSetup(params)}
        <div class="step-actions">
          <wa-button id="generate" variant="brand" size="l" class="grow">
            <wa-icon slot="start" name="wand-magic-sparkles"></wa-icon> Generate flightplan
          </wa-button>
        </div>
        <p class="muted">
          ${escapeHtml(droneLabel(params.droneType))},
          ${params.useGsd ? `${params.gsd} cm/px` : `${params.agl} m altitude`},
          ${params.forwardOverlap}/${params.sideOverlap}% overlap,
          ${dem.sampler && params.terrainFollow ? "terrain following" : "fixed altitude"}.
        </p>
        <div id="generate-error"></div>
      `;
    }

    const budget = batteryBudget(params.droneType, result.estimatedFlightTimeMinutes);

    const altitudes = result.waypoints.features
      .map((f) => f.geometry.coordinates[2])
      .filter((v): v is number => typeof v === "number");
    const altMin = altitudes.length ? Math.round(Math.min(...altitudes)) : 0;
    const altMax = altitudes.length ? Math.round(Math.max(...altitudes)) : 0;

    const batteryCallout = result.batteryWarning
      ? `<wa-callout variant="warning" appearance="outlined">
           <wa-icon slot="icon" name="battery-quarter"></wa-icon>
           <strong>This flight is longer than one battery.</strong>
           <p>
             Estimated ${escapeHtml(minutes(result.estimatedFlightTimeMinutes))} against
             about ${budget ? Math.round(budget.limitMinutes) : "?"} min of usable flight time.
             Split the area into smaller parts, or raise the GSD to fly higher and cover
             more per pass.
           </p>
         </wa-callout>`
      : `<wa-callout variant="success" appearance="outlined" size="s">
           <wa-icon slot="icon" name="battery-full"></wa-icon>
           Fits within one battery.
         </wa-callout>`;

    const noFlyReturnCallout = result.noFlyReturnWarning
      ? `<wa-callout variant="warning" appearance="outlined">
           <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
           <strong>Returning home early would cross a no-fly zone.</strong>
           <p>Don't press Return to Home mid-flight, and keep enough battery to finish.</p>
         </wa-callout>`
      : "";

    const missingCallout =
      result.sampled && result.sampled.missing > 0
        ? `<wa-callout variant="warning" appearance="outlined" size="s">
             <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
             <strong>${result.sampled.missing} waypoints had no elevation data.</strong>
             <p>They use the takeoff height instead. This is usually water. Check them on the map.</p>
           </wa-callout>`
        : "";

    const eveWaypointCount = result.waypoints.features.length;
    const exceedsEveWaypointLimit =
      params.droneType === "POTENSIC_ATOM_2" &&
      params.potensicApp === "eve" &&
      eveWaypointCount > POTENSIC_EVE_MAX_WAYPOINTS;
    const eveWaypointWarning = exceedsEveWaypointLimit
      ? `<wa-callout variant="warning" appearance="outlined">
           <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
           <strong>Potensic Eve download disabled: ${eveWaypointCount} waypoints exceeds the ${POTENSIC_EVE_MAX_WAYPOINTS}-waypoint limit.</strong>
           <p>Split the area into smaller missions. The Eve mission file is disabled below; the GeoJSON review files remain available.</p>
         </wa-callout>`
      : "";

    return `
      ${coachLead("generate")}
      ${flightSetup(params)}

      <div class="stat-row">
        <div class="stat"><span class="stat-label">Waypoints</span>
          <span class="stat-value">${result.waypoints.features.length}</span></div>
        <div class="stat"><span class="stat-label">Photos</span>
          <span class="stat-value">${params.flightMode === "waylines" ? "~" : ""}${result.photos}</span></div>
        <div class="stat"><span class="stat-label">Flight time</span>
          <span class="stat-value">${escapeHtml(minutes(result.estimatedFlightTimeMinutes))}</span></div>
      </div>

      <div class="stat-row">
        <div class="stat"><span class="stat-label">Altitude</span>
          <span class="stat-value">${altMin === altMax ? `${altMin} m` : `${altMin}-${altMax} m`}</span></div>
        <div class="stat"><span class="stat-label">Speed</span>
          <span class="stat-value">${result.parameters.ground_speed} m/s</span></div>
        <div class="stat"><span class="stat-label">Terrain</span>
          <span class="stat-value">${result.terrainFollowing ? "Following" : "Fixed"}</span></div>
      </div>

      ${batteryCallout}
      ${noFlyReturnCallout}
      ${missingCallout}
      ${eveWaypointWarning}

      ${checklistCard(ctx.state)}

      <h3 class="downloads-title">Download</h3>
      <div class="downloads">${downloadRow(outputs[0], 0)}</div>

      <wa-details summary="Other file types" appearance="outlined">
        <div class="downloads">
          ${outputs
            .slice(1)
            .map((file, index) => downloadRow(file, index + 1))
            .join("")}
        </div>
      </wa-details>

      <wa-details summary="Save a backup copy" appearance="outlined">
        <p class="muted">
          The browser can delete its stored data when it runs out of space. This
          saves the area, the settings and the plan into one ZIP file that you
          can keep.
        </p>
        <div class="step-actions">
          <wa-button id="bundle" appearance="outlined" size="s">
            <wa-icon slot="start" name="file-zipper"></wa-icon> Download plan bundle
          </wa-button>
        </div>
      </wa-details>

      <div class="step-actions">
        <wa-button id="regenerate" appearance="plain" size="s">
          <wa-icon slot="start" name="rotate"></wa-icon> Generate again
        </wa-button>
      </div>

      <div id="generate-error"></div>
    `;
  },

  mount(root, ctx) {
    const run = async () => {
      const { aoi, params, dem } = ctx.state;
      if (!aoi) return;
      root.querySelector("#generate-error")!.innerHTML = "";

      try {
        const sampler = params.terrainFollow ? dem.sampler : null;
        const result = buildPlan(aoi.ring, params, sampler);
        ctx.state.result = result;
        ctx.state.meta.generatedAt ??= new Date().toISOString();
        outputs = buildOutputs(result, params, ctx.state.meta);

        ctx.map.showPlan(result.waypoints, result.flightpath);
        ctx.map.fitBbox(aoi.bbox);

        await ctx.save();

        ctx.refresh();
      } catch (error) {
        // A plan for the previous settings must not stay downloadable.
        if (ctx.state.result) {
          ctx.state.result = null;
          ctx.map.showPlan(null, null);
          ctx.refresh();
        }
        root.querySelector("#generate-error")!.innerHTML = errorPanel(
          "Could not generate the flightplan.",
          error instanceof Error
            ? error.message
            : "Try a simpler area, or check the flight settings.",
        );
      }
    };

    root.querySelector("#generate")?.addEventListener("click", run);
    root.querySelector("#regenerate")?.addEventListener("click", run);
    root.querySelector("#change-takeoff")?.addEventListener("click", () => ctx.goTo(2));

    const drone = root.querySelector<HTMLElement & { value: string }>("#drone-type");
    drone?.addEventListener("change", () => {
      const nextDroneType = drone.value as DroneTypeKey;
      ctx.state.params.droneType = nextDroneType;
      ctx.state.params.potensicApp = potensicAppForDrone(
        nextDroneType,
        ctx.state.params.potensicApp,
      );
      void run();
    });
    const potensicApp = root.querySelector<HTMLElement & { value: string }>("#potensic-app");
    potensicApp?.addEventListener("change", () => {
      if (potensicApp.value !== "android" && potensicApp.value !== "eve") return;
      ctx.state.params.potensicApp = potensicApp.value as PotensicAppKey;
      void run();
    });

    // Opened from DroneTM: show the plan without a tap.
    if (ctx.state.handoff && !ctx.state.result && !step4.blocker(ctx.state)) void run();
    ctx.state.handoff = false;

    for (const button of root.querySelectorAll<HTMLElement>("[data-download]")) {
      button.addEventListener("click", () => {
        const file = outputs[Number(button.dataset.download)];
        if (!file || file.disabled) return;
        download(file);
        promptSiteChecks(ctx);
      });
    }

    mountChecklistCard(root, ctx);

    root.querySelector("#bundle")?.addEventListener("click", () => {
      const { aoi, params, meta } = ctx.state;
      if (!aoi) return;
      const terrain = bundleTerrain(ctx.state);
      const bundleMeta = terrain.dem ? { ...meta, dem: terrain.dem } : meta;
      const geojson = {
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            properties: { name: planLabel(meta) },
            geometry: { type: "Polygon", coordinates: [aoi.ring] },
          },
        ],
      };
      download({
        name: `${meta.id}_bundle.zip`,
        data: buildPlanBundle(bundleMeta, geojson, params, outputs, terrain.bytes),
        mime: "application/zip",
        label: "Plan bundle",
        hint: "",
      });
    });

    if (ctx.state.result) {
      ctx.map.showPlan(ctx.state.result.waypoints, ctx.state.result.flightpath);
    }
  },
};
