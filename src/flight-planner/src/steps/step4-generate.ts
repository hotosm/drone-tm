import type { Step } from "../app";
import { batteryBudget, buildPlan } from "../core/flightplan";
import { DRONE_CHOICES } from "../core/qfield";
import {
  buildOutputs,
  buildPlanBundle,
  byteSize,
  planLabel,
  download,
  formatBytes,
  type OutputFile,
} from "../core/outputs";
import { coachLead, coachTips } from "../tutorial";
import { errorPanel, escapeHtml, infoPanel } from "./ui";

let outputs: OutputFile[] = [];

function droneLabel(key: string): string {
  return DRONE_CHOICES.find((choice) => choice.value === key)?.label ?? key;
}

function minutes(value: number): string {
  if (value < 1) return "under a minute";
  const whole = Math.floor(value);
  const secs = Math.round((value - whole) * 60);
  return secs >= 30 ? `${whole + 1} min` : `${whole} min`;
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
        ${coachTips("generate")}
        <div id="generate-error"></div>
      `;
    }

    const budget = batteryBudget(params.droneType, result.estimatedFlightTimeMinutes);
    const photos = result.waypoints.features.filter((f) => f.properties.take_photo).length;

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
           Fits comfortably within one battery.
         </wa-callout>`;

    const missingCallout =
      result.sampled && result.sampled.missing > 0
        ? `<wa-callout variant="warning" appearance="outlined" size="s">
             <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
             <strong>${result.sampled.missing} waypoints had no elevation data.</strong>
             <p>They use the takeoff height instead. Usually water - worth a look on the map.</p>
           </wa-callout>`
        : "";

    return `
      ${coachLead("generate")}

      <div class="stat-row">
        <div class="stat"><span class="stat-label">Waypoints</span>
          <span class="stat-value">${result.waypoints.features.length}</span></div>
        <div class="stat"><span class="stat-label">Photos</span>
          <span class="stat-value">${photos}</span></div>
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
      ${missingCallout}

      ${coachTips("generate")}

      <h3 class="downloads-title">Download</h3>
      <div class="downloads">
        ${outputs
          .map(
            (file, index) => `
          <div class="download-row">
            <div class="download-meta">
              <strong>${escapeHtml(file.label)}</strong>
              <span class="muted">${escapeHtml(file.hint)}</span>
            </div>
            <wa-button data-download="${index}" appearance="outlined" size="s">
              <wa-icon slot="start" name="download"></wa-icon>
              ${escapeHtml(formatBytes(byteSize(file.data)))}
            </wa-button>
          </div>`,
          )
          .join("")}
      </div>

      <wa-details summary="Keep a copy off this browser" appearance="outlined">
        <p class="muted">
          Browser storage can be cleared by the browser itself when space runs
          short. This bundles the area, the settings and the plan into one ZIP
          you can keep.
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
    const errorHost = root.querySelector<HTMLElement>("#generate-error")!;

    const run = async () => {
      const { aoi, params, dem } = ctx.state;
      if (!aoi) return;
      errorHost.innerHTML = "";

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
        errorHost.innerHTML = errorPanel(
          "Could not generate the flightplan.",
          error instanceof Error
            ? error.message
            : "Try a simpler area, or check the flight settings.",
        );
      }
    };

    root.querySelector("#generate")?.addEventListener("click", run);
    root.querySelector("#regenerate")?.addEventListener("click", run);

    for (const button of root.querySelectorAll<HTMLElement>("[data-download]")) {
      button.addEventListener("click", () => {
        const file = outputs[Number(button.dataset.download)];
        if (file) download(file);
      });
    }

    root.querySelector("#bundle")?.addEventListener("click", () => {
      const { aoi, params, meta, dem } = ctx.state;
      if (!aoi) return;
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
        data: buildPlanBundle(meta, geojson, params, outputs, dem.bytes),
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
