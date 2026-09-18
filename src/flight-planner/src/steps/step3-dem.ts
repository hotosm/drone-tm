import type { Step, StepContext } from "../app";
import {
  bboxIncludingPoint,
  DemAreaError,
  DemSampler,
  fetchDem,
  snapBbox,
  type Bbox,
} from "../core/dem";
import { formatBytes } from "../core/outputs";
import { paramsBlocker } from "../core/params";
import { requestPersistence } from "../core/storage";
import { coachLead, coachTips } from "../tutorial";
import { HINTS } from "../tutorial/content";
import { errorPanel, escapeHtml, infoPanel, successPanel } from "./ui";
import { onFilePicked } from "./dropzone";

function demSizeNote(bbox: Bbox): string {
  const { width, height } = snapBbox(bbox);
  const bytes = width * height * 4;
  return `About ${formatBytes(bytes)} (${width} x ${height} points at 30 m spacing).`;
}

function requiredBbox(ctx: StepContext): Bbox {
  return bboxIncludingPoint(ctx.state.aoi!.bbox, ctx.state.params.takeoffPoint);
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

    let sizeNote = "";
    let areaError = "";
    try {
      sizeNote = demSizeNote(requiredBbox(ctx));
    } catch (error) {
      if (error instanceof DemAreaError) {
        areaError = errorPanel(error.message, error.guidance);
      }
    }

    if (dem.sampler) {
      const range = dem.sampler.range();
      const relief = Math.round(range.max - range.min);
      return `
        ${coachLead("dem")}
        ${successPanel(
          dem.source === "UPLOAD" ? "Your DEM is loaded." : "Terrain downloaded.",
          "You can now work offline. This stays saved in this browser.",
        )}
        <div class="stat-row">
          <div class="stat"><span class="stat-label">Ground height</span>
            <span class="stat-value">${Math.round(range.min)}-${Math.round(range.max)} m</span></div>
          <div class="stat"><span class="stat-label">Relief</span>
            <span class="stat-value">${relief} m</span></div>
          <div class="stat"><span class="stat-label">Grid</span>
            <span class="stat-value">${
              dem.snapped ? `${dem.snapped.width}x${dem.snapped.height}` : "your file"
            }</span></div>
        </div>
        ${
          range.voids > 0
            ? `<wa-callout variant="warning" appearance="outlined" size="s">
                 <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
                 <strong>${range.voids} of ${dem.sampler.pixelCount} points have no elevation.</strong>
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

      <div class="step-actions">
        <wa-button id="dem-fetch" variant="brand" size="l" class="grow" ${areaError ? "disabled" : ""}>
          <wa-icon slot="start" name="mountain-sun"></wa-icon> Download terrain
        </wa-button>
      </div>
      ${sizeNote ? `<p class="muted">${escapeHtml(sizeNote)}</p>` : ""}

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
      const aoi = ctx.state.aoi;
      if (!aoi) return;
      errorHost.innerHTML = "";
      if (progress) progress.hidden = false;

      try {
        const { bytes, url, snapped } = await fetchDem(requiredBbox(ctx));
        const sampler = await DemSampler.fromBytes(bytes);

        ctx.state.dem = {
          sampler,
          snapped,
          bytes,
          source: "GLO30",
          skipped: false,
        };
        ctx.state.meta.dem = {
          bbox: snapped.bbox,
          width: snapped.width,
          height: snapped.height,
          sourceUrl: url,
          fetchedAt: new Date().toISOString(),
          byteLength: bytes.byteLength,
          source: "GLO30",
        };
        ctx.state.result = null;

        const persisted = await requestPersistence();
        await ctx.save(true);

        ctx.toast(
          persisted
            ? "Terrain saved. You can work offline from here."
            : "Terrain saved in this browser.",
          "success",
        );
        ctx.refresh();
      } catch (error) {
        showError(error);
      } finally {
        if (progress) progress.hidden = true;
      }
    };

    root.querySelector("#dem-fetch")?.addEventListener("click", fetchTerrain);
    root.querySelector("#dem-refetch")?.addEventListener("click", fetchTerrain);

    root.querySelector("#dem-skip")?.addEventListener("click", async () => {
      ctx.state.dem = {
        sampler: null,
        snapped: null,
        bytes: null,
        source: null,
        skipped: true,
      };
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
      errorHost.innerHTML = "";
      try {
        const bytes = await file.arrayBuffer();
        const sampler = await DemSampler.fromBytes(bytes);
        const aoi = ctx.state.aoi!;
        const requiredPoints = [...aoi.ring];
        if (ctx.state.params.takeoffPoint) {
          const { lon, lat } = ctx.state.params.takeoffPoint;
          requiredPoints.push([lon, lat]);
        }
        if (requiredPoints.some(([lon, lat]) => !sampler.contains(lon, lat))) {
          errorHost.innerHTML = errorPanel(
            "That DEM does not cover your flight area.",
            "Check it is in longitude/latitude (EPSG:4326) and covers the area you drew.",
          );
          return;
        }
        if (sampler.range().voids === sampler.pixelCount) {
          errorHost.innerHTML = errorPanel(
            "That DEM contains no usable elevation values.",
            "Check the file uses metres and has data over the flight area.",
          );
          return;
        }

        ctx.state.dem = { sampler, snapped: null, bytes, source: "UPLOAD", skipped: false };
        ctx.state.meta.dem = {
          bbox: aoi.bbox,
          width: 0,
          height: 0,
          sourceUrl: `upload:${file.name}`,
          fetchedAt: new Date().toISOString(),
          byteLength: bytes.byteLength,
          source: "UPLOAD",
        };
        ctx.state.result = null;
        await ctx.save(true);
        ctx.toast(`Using ${escapeHtml(file.name)}.`, "success");
        ctx.refresh();
      } catch (error) {
        showError(error);
      }
    });
  },
};
