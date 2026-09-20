import { NO_TERRAIN, type Step, type StepContext } from "../app";
import {
  bboxIncludingPoint,
  bboxSizeKm,
  DemAreaError,
  DemSampler,
  fetchDem,
  planDemBbox,
  type Bbox,
  type DemPlan,
} from "../core/dem";
import { formatBytes, formatExtent } from "../core/outputs";
import { paramsBlocker } from "../core/params";
import {
  findCoveringDem,
  getDemBytes,
  glo30DemKey,
  requestPersistence,
  storageEstimate,
  uploadDemKey,
  type DemEntry,
} from "../core/storage";
import { coachLead, coachTips } from "../tutorial";
import { HINTS } from "../tutorial/content";
import { errorPanel, escapeHtml, infoPanel, successPanel } from "./ui";
import { onFilePicked } from "./dropzone";

function requiredBbox(ctx: StepContext): Bbox {
  return bboxIncludingPoint(ctx.state.aoi!.bbox, ctx.state.params.takeoffPoint);
}

function projectBbox(ctx: StepContext): Bbox | null {
  return ctx.state.projectBbox ?? ctx.state.meta.projectBbox ?? null;
}

function demPlan(ctx: StepContext): DemPlan {
  return planDemBbox({ required: requiredBbox(ctx), context: projectBbox(ctx) });
}

function coverageLabel(plan: DemPlan, hasProject: boolean): string {
  const extent = formatExtent(plan.snapped.bbox);
  if (!hasProject) return `${extent} around this area`;
  return plan.coversContext ? "This whole project" : `${extent} of this project`;
}

function downloadNote(plan: DemPlan, hasProject: boolean): string {
  const size = formatBytes(plan.bytes);
  const extent = formatExtent(plan.snapped.bbox);

  if (hasProject && plan.coversContext) {
    return `About ${size}, covering this whole project (${extent}). Every other area
      in it can then be planned with no connection.`;
  }
  if (hasProject) {
    return `About ${size}, covering ${extent} of this project. Areas further away
      need their own download, while you still have a signal.`;
  }
  return `About ${size}, covering ${extent} around this area - not just the part
    you are flying. Nearby areas can then be planned with no connection.`;
}

function coveragePanel(entry: DemEntry, required: Bbox): string {
  const reach = entry.source === "UPLOAD" ? "your own file" : formatExtent(entry.bbox);
  const spare = bboxSizeKm(entry.bbox).widthKm / Math.max(bboxSizeKm(required).widthKm, 0.001);

  return `<wa-callout variant="brand" appearance="outlined" size="s">
            <wa-icon slot="icon" name="map-location-dot"></wa-icon>
            <strong>Saved terrain covers ${escapeHtml(reach)}.</strong>
            <p>${
              spare > 3
                ? `Other areas inside that box need no further download - open them ` +
                  `here and this terrain is picked up automatically.`
                : `Areas outside that box need their own download, while you have a signal.`
            }</p>
          </wa-callout>`;
}

/** Checks that async work still belongs to the active plan and AOI. */
function stillCurrent(ctx: StepContext, at: { planId: string; aoi: unknown }): boolean {
  return ctx.state.meta.id === at.planId && ctx.state.aoi === at.aoi;
}

function currentPlan(ctx: StepContext): { planId: string; aoi: unknown } {
  return { planId: ctx.state.meta.id, aoi: ctx.state.aoi };
}

async function useStoredDem(
  ctx: StepContext,
  entry: DemEntry,
  cancelled: () => boolean,
): Promise<boolean> {
  const at = currentPlan(ctx);
  const bytes = await getDemBytes(entry.key);
  if (!bytes) return false;

  const sampler = await DemSampler.fromBytes(bytes);
  if (cancelled() || !stillCurrent(ctx, at)) return false;

  const dem: StepContext["state"]["dem"] = {
    sampler,
    bytes,
    entry,
    fromStore: true,
    saved: true,
    skipped: false,
  };
  ctx.state.dem = dem;
  ctx.state.meta.dem = { ...entry };
  ctx.state.storedUpload = null;
  ctx.state.result = null;
  dem.saved = await ctx.save();
  if (cancelled() || !stillCurrent(ctx, at)) return false;
  return true;
}

export const step3: Step = {
  key: "dem",
  label: "Terrain",

  blocker(state) {
    if (!state.aoi) return "Mark a flight area first.";
    const invalidParams = paramsBlocker(state.params);
    if (invalidParams) return invalidParams;
    if (state.dem.sampler || state.dem.skipped) return null;
    return "Download the terrain, or choose to fly at a fixed altitude.";
  },

  render(ctx) {
    const { aoi, dem } = ctx.state;
    if (!aoi) return infoPanel("Mark a flight area first.");

    const hasProject = projectBbox(ctx) !== null;
    let plan: DemPlan | null = null;
    let areaError = "";
    try {
      plan = demPlan(ctx);
    } catch (error) {
      if (error instanceof DemAreaError) {
        areaError = errorPanel(error.message, error.guidance);
      }
    }

    if (dem.sampler && dem.entry) {
      const range = dem.sampler.range(requiredBbox(ctx));
      const relief = Math.round(range.max - range.min);
      const reused = dem.entry.source === "GLO30" && dem.fromStore;

      const headline =
        dem.entry.source === "UPLOAD"
          ? "Your DEM is loaded."
          : reused
            ? "Terrain ready, from an earlier download."
            : "Terrain downloaded.";

      return `
        ${coachLead("dem")}
        ${
          dem.saved
            ? successPanel(headline, "You can now work offline. This stays saved in this browser.")
            : errorPanel(
                `${headline} It could not be saved.`,
                "This browser is probably out of space, so it will be gone when you " +
                  "leave. Free some terrain under Saved plans, then download again.",
              )
        }
        <div class="stat-row">
          <div class="stat"><span class="stat-label">Ground height</span>
            <span class="stat-value">${Math.round(range.min)}-${Math.round(range.max)} m</span></div>
          <div class="stat"><span class="stat-label">Relief</span>
            <span class="stat-value">${relief} m</span></div>
          <div class="stat"><span class="stat-label">Saved</span>
            <span class="stat-value">${escapeHtml(formatBytes(dem.entry.byteLength))}</span></div>
        </div>

        ${coveragePanel(dem.entry, requiredBbox(ctx))}

        ${
          range.voids > 0
            ? `<wa-callout variant="warning" appearance="outlined" size="s">
                 <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
                 <strong>${range.voids} of ${range.count} points over your area have no
                   elevation.</strong>
                 <p>Usually water. Waypoints over those spots fall back to the
                    takeoff height, so check the plan before you fly.</p>
               </wa-callout>`
            : ""
        }
        ${
          relief < 10
            ? infoPanel(
                "This site is nearly flat.",
                "Terrain following will barely change the plan here, but it does no harm.",
              )
            : ""
        }
        <wa-switch id="terrain-follow" ${ctx.state.params.terrainFollow ? "checked" : ""}
          hint="${escapeHtml(HINTS.terrainFollow)}">Follow the terrain</wa-switch>

        <wa-details summary="Fine tuning" appearance="outlined">
          <wa-input id="threshold" type="number" label="Height tolerance"
            hint="${escapeHtml(HINTS.threshold)}"
            value="${ctx.state.params.threshold}" min="1" max="50" step="1"
          ><span slot="end">m</span></wa-input>
        </wa-details>

        ${coachTips("dem")}

        <div class="step-actions">
          <wa-button id="dem-refetch" appearance="outlined" size="s">
            <wa-icon slot="start" name="rotate"></wa-icon> Download again
          </wa-button>
        </div>
        <div id="dem-error"></div>
      `;
    }

    return `
      ${coachLead("dem")}
      ${areaError}

      ${
        dem.skipped
          ? infoPanel(
              "Flying at a fixed altitude.",
              "Heights are measured from your takeoff point. Fine on flat ground.",
            )
          : ""
      }
      ${
        navigator.onLine || dem.skipped
          ? ""
          : `<wa-callout variant="warning" appearance="outlined" size="s">
               <wa-icon slot="icon" name="plug-circle-xmark"></wa-icon>
               <strong>You are offline, and no saved terrain covers this area.</strong>
               <p>Find a signal and download it here, or fly at a fixed altitude
                  instead.</p>
             </wa-callout>`
      }

      ${
        ctx.state.storedUpload
          ? `<wa-callout variant="brand" appearance="outlined" size="s">
               <wa-icon slot="icon" name="file-arrow-up"></wa-icon>
               <strong>You have your own DEM covering this area.</strong>
               <p>${escapeHtml(ctx.state.storedUpload.label ?? "An uploaded DEM")} -
                  ${escapeHtml(formatExtent(ctx.state.storedUpload.bbox))}. Use it only if it
                  is the right terrain for this area.</p>
               <wa-button id="dem-use-upload" appearance="outlined" size="s">
                 Use that DEM
               </wa-button>
             </wa-callout>`
          : ""
      }

      <div class="step-actions">
        <wa-button id="dem-fetch" variant="brand" size="l" class="grow" ${areaError ? "disabled" : ""}>
          <wa-icon slot="start" name="mountain-sun"></wa-icon> Download terrain
        </wa-button>
      </div>
      ${plan ? `<p class="muted">${escapeHtml(downloadNote(plan, hasProject))}</p>` : ""}

      <div id="dem-progress" hidden>
        <wa-progress-bar indeterminate label="Downloading terrain"></wa-progress-bar>
        <p class="muted">Copernicus GLO-30, via HOT's imagery service. A few seconds.</p>
      </div>

      ${coachTips("dem")}

      <wa-details summary="No signal, or flat ground?" appearance="outlined">
        <p class="muted">
          You can skip this and fly at one fixed altitude above your takeoff
          point. On a hill that means flying too low on the way up and too high
          on the way down, so only skip it on flat ground.
        </p>
        <div class="step-actions">
          <wa-button id="dem-skip" appearance="outlined" size="s">
            Fly at a fixed altitude
          </wa-button>
        </div>
      </wa-details>

      <wa-details summary="Use your own DEM" appearance="outlined">
        <p class="muted">
          A GeoTIFF of ground height in metres, in longitude/latitude
          (EPSG:4326). Useful if you have survey data, or if this area is too
          large for the service.
        </p>
        <hot-file-input-dropzone
          id="dem-drop"
          accept=".tif,.tiff,image/tiff"
          label="Drop a GeoTIFF here, or tap to choose"
          variant="compact"
        ></hot-file-input-dropzone>
      </wa-details>

      <div id="dem-error"></div>
    `;
  },

  mount(root, ctx) {
    const errorHost = root.querySelector<HTMLElement>("#dem-error")!;
    const progress = root.querySelector<HTMLElement>("#dem-progress");

    let cancelled = false;
    let operation = 0;
    const startOperation = () => ++operation;
    const isStale = (id: number, at: ReturnType<typeof currentPlan>) =>
      cancelled || id !== operation || !stillCurrent(ctx, at);

    const showError = (error: unknown) => {
      if (error instanceof DemAreaError) {
        errorHost.innerHTML = errorPanel(error.message, error.guidance);
      } else {
        errorHost.innerHTML = errorPanel(
          "Could not get the terrain.",
          error instanceof Error
            ? error.message
            : "Check your connection, or skip this step and fly at a fixed altitude.",
        );
      }
    };

    const fetchTerrain = async () => {
      if (!ctx.state.aoi) return;
      const id = startOperation();
      const at = currentPlan(ctx);
      errorHost.innerHTML = "";
      if (progress) progress.hidden = false;

      try {
        const plan = demPlan(ctx);

        const estimate = await storageEstimate();
        if (isStale(id, at)) return;
        if (estimate && plan.bytes > estimate.quota - estimate.usage) {
          errorHost.innerHTML = errorPanel(
            `This browser has room for ${formatBytes(estimate.quota - estimate.usage)}, ` +
              `and this terrain needs about ${formatBytes(plan.bytes)}.`,
            "Free some terrain under Saved plans, or fly at a fixed altitude instead.",
          );
          return;
        }

        const { bytes, url, snapped } = await fetchDem(plan.bbox);
        const sampler = await DemSampler.fromBytes(bytes);
        if (isStale(id, at)) return;

        const entry: DemEntry = {
          key: glo30DemKey(snapped.bbox),
          bbox: snapped.bbox,
          width: snapped.width,
          height: snapped.height,
          sourceUrl: url,
          fetchedAt: new Date().toISOString(),
          byteLength: bytes.byteLength,
          source: "GLO30",
          label: coverageLabel(plan, projectBbox(ctx) !== null),
        };

        const persisted = await requestPersistence();
        if (isStale(id, at)) return;

        const dem: StepContext["state"]["dem"] = {
          sampler,
          bytes,
          entry,
          fromStore: false,
          saved: true,
          skipped: false,
        };
        ctx.state.dem = dem;
        ctx.state.storedUpload = null;
        ctx.state.result = null;

        const saved = await ctx.save(true);
        dem.saved = saved;
        if (isStale(id, at)) return;

        if (saved) {
          ctx.toast(
            persisted
              ? "Terrain saved. You can work offline from here."
              : "Terrain saved in this browser.",
            "success",
          );
        }
        ctx.refresh();
      } catch (error) {
        if (!isStale(id, at)) showError(error);
      } finally {
        if (!cancelled && id === operation && progress) progress.hidden = true;
      }
    };

    root.querySelector("#dem-fetch")?.addEventListener("click", fetchTerrain);
    root.querySelector("#dem-refetch")?.addEventListener("click", fetchTerrain);

    root.querySelector("#dem-skip")?.addEventListener("click", async () => {
      startOperation();
      ctx.state.dem = { ...NO_TERRAIN, skipped: true };
      ctx.state.params.terrainFollow = false;
      ctx.state.result = null;
      await ctx.save();
      ctx.refresh();
    });

    const terrainFollow = root.querySelector<HTMLElement & { checked: boolean }>("#terrain-follow");
    terrainFollow?.addEventListener("change", () => {
      ctx.state.params.terrainFollow = terrainFollow.checked;
      ctx.state.result = null;
    });

    const threshold = root.querySelector<HTMLElement & { value: string }>("#threshold");
    threshold?.addEventListener("change", () => {
      const value = Number(threshold.value);
      if (Number.isFinite(value)) {
        ctx.state.params.threshold = value;
        ctx.state.result = null;
      }
    });

    onFilePicked(root.querySelector("#dem-drop"), async (file) => {
      const id = startOperation();
      const at = currentPlan(ctx);
      errorHost.innerHTML = "";
      try {
        const bytes = await file.arrayBuffer();
        const sampler = await DemSampler.fromBytes(bytes);
        if (isStale(id, at)) return;

        const required = requiredBbox(ctx);
        if (!sampler.covers(required)) {
          errorHost.innerHTML = errorPanel(
            "That DEM does not cover your flight area.",
            "Check it is in longitude/latitude (EPSG:4326) and covers the area you drew, " +
              "with a little margin for the turns outside it.",
          );
          return;
        }
        const overArea = sampler.range(required);
        if (overArea.voids === overArea.count) {
          errorHost.innerHTML = errorPanel(
            "That DEM has no elevation values over your flight area.",
            "Check the file uses metres and has data over the area you drew.",
          );
          return;
        }

        const { width, height } = sampler.size();
        const key = await uploadDemKey(file.name, bytes);
        if (isStale(id, at)) return;

        const dem: StepContext["state"]["dem"] = {
          sampler,
          bytes,
          entry: {
            key,
            bbox: sampler.bounds(),
            width,
            height,
            sourceUrl: `upload:${file.name}`,
            fetchedAt: new Date().toISOString(),
            byteLength: bytes.byteLength,
            source: "UPLOAD",
            label: file.name,
          },
          fromStore: false,
          saved: true,
          skipped: false,
        };
        ctx.state.dem = dem;
        ctx.state.storedUpload = null;
        ctx.state.result = null;

        const saved = await ctx.save(true);
        dem.saved = saved;
        if (isStale(id, at)) return;
        if (saved) ctx.toast(`Using ${file.name}.`, "success");
        ctx.refresh();
      } catch (error) {
        if (!isStale(id, at)) showError(error);
      }
    });

    root.querySelector("#dem-use-upload")?.addEventListener("click", async () => {
      const upload = ctx.state.storedUpload;
      if (!upload) return;
      const id = startOperation();
      const at = currentPlan(ctx);
      errorHost.innerHTML = "";
      try {
        if (await useStoredDem(ctx, upload, () => isStale(id, at))) {
          ctx.toast(`Using ${upload.label ?? "your DEM"}.`, "success");
          ctx.refresh();
        }
      } catch (error) {
        if (!isStale(id, at)) showError(error);
      }
    });

    // GLO-30 is reused automatically; uploads require confirmation.
    const lookup = async () => {
      const { state } = ctx;
      if (!state.aoi || state.dem.sampler || state.dem.skipped) return;

      const id = startOperation();
      const at = currentPlan(ctx);
      const required = requiredBbox(ctx);

      const downloaded = await findCoveringDem(required);
      if (isStale(id, at)) return;
      if (downloaded) {
        if (await useStoredDem(ctx, downloaded, () => isStale(id, at))) {
          ctx.toast("Using terrain you already downloaded.", "success");
          ctx.refresh();
        }
        return;
      }

      const uploaded = await findCoveringDem(required, { source: "UPLOAD" });
      if (isStale(id, at) || !uploaded) return;
      if (state.storedUpload?.key === uploaded.key) return;
      state.storedUpload = uploaded;
      ctx.refresh();
    };

    void lookup().catch(() => {});

    return () => {
      cancelled = true;
      operation++;
    };
  },
};
