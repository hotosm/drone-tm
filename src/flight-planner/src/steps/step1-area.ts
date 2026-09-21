import { resetTerrain, type Step } from "../app";
import { AoiError, formatArea, readAoiFile, validateRing } from "../core/aoi";
import { coachLead, coachTips } from "../tutorial";
import { escapeHtml, errorPanel } from "./ui";
import { onFilePicked } from "./dropzone";

const LARGE_AREA_HA = 50;

export const step1: Step = {
  key: "aoi",
  label: "Area",

  blocker(state) {
    return state.aoi ? null : "Draw or upload a flight area to continue.";
  },

  render(ctx) {
    const { aoi } = ctx.state;

    const summary = aoi
      ? `<div class="stat-row">
           <div class="stat"><span class="stat-label">Area</span>
             <span class="stat-value">${formatArea(aoi.areaM2)}</span></div>
           <div class="stat"><span class="stat-label">Corners</span>
             <span class="stat-value">${aoi.ring.length - 1}</span></div>
         </div>
         ${
           aoi.areaM2 / 10_000 > LARGE_AREA_HA
             ? `<wa-callout variant="warning" appearance="outlined" size="s">
                  <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
                  That is a large area for one flight. You can carry on - step 4
                  will tell you if it needs more than one battery.
                </wa-callout>`
             : ""
         }`
      : "";

    return `
      ${coachLead("aoi")}

      <div class="step-actions">
        <wa-button id="draw-area" variant="brand" size="l" class="grow">
          <wa-icon slot="start" name="draw-polygon"></wa-icon>
          ${aoi ? "Redraw area" : "Draw area on map"}
        </wa-button>
        ${
          aoi
            ? `<wa-button id="clear-area" appearance="outlined" size="l">
                 <wa-icon slot="start" name="trash-can"></wa-icon> Clear
               </wa-button>`
            : ""
        }
      </div>

      ${summary}

      ${coachTips("aoi")}

      <wa-details summary="Or upload a file" appearance="outlined" class="upload-fold" ${aoi ? "" : "open"}>
        <p class="muted">
          A GeoJSON with a Polygon, in longitude/latitude (EPSG:4326).
        </p>
        <hot-file-input-dropzone
          id="aoi-drop"
          accept=".geojson,.json,application/geo+json,application/json"
          label="Drop a GeoJSON here, or tap to choose"
          variant="compact"
        ></hot-file-input-dropzone>
      </wa-details>

      <div id="aoi-error"></div>
    `;
  },

  mount(root, ctx) {
    const errorHost = root.querySelector<HTMLElement>("#aoi-error")!;

    const accept = (result: ReturnType<typeof validateRing>, fitTo = true) => {
      ctx.state.aoi = result;
      resetTerrain(ctx.state);
      ctx.map.showPlan(null, null);
      if (fitTo) ctx.map.fitBbox(result.bbox);
      errorHost.innerHTML = "";
      ctx.sheet.restore();
      ctx.refresh();
      void ctx.save();
    };

    const showError = (error: unknown) => {
      if (error instanceof AoiError) {
        errorHost.innerHTML = errorPanel(error.message, error.guidance);
      } else {
        errorHost.innerHTML = errorPanel(
          "Could not read that area.",
          error instanceof Error ? error.message : "Try drawing it on the map instead.",
        );
      }
    };

    root.querySelector("#draw-area")?.addEventListener("click", () => {
      errorHost.innerHTML = "";
      ctx.sheet.collapseForMap();
      ctx.map.startDrawing();
      ctx.toast("Tap each corner on the map, then tap the first corner to finish.");
    });

    root.querySelector("#clear-area")?.addEventListener("click", () => {
      ctx.map.clearRing();
      ctx.state.aoi = null;
      resetTerrain(ctx.state);
      ctx.map.showPlan(null, null);
      ctx.refresh();
      void ctx.save();
    });

    onFilePicked(root.querySelector("#aoi-drop"), async (file) => {
      try {
        const result = await readAoiFile(file);
        ctx.map.setRing(result.ring);
        accept(result);
        ctx.toast(`Loaded ${escapeHtml(file.name)}.`, "success");
      } catch (error) {
        showError(error);
      }
    });

    return ctx.map.onChange(() => {
      if (ctx.state.step !== 1) return;
      const ring = ctx.map.ring();
      if (!ring) return;
      const current = ctx.state.aoi?.ring;
      if (current && JSON.stringify(current) === JSON.stringify(ring)) return;
      try {
        accept(validateRing(ring), false);
      } catch (error) {
        showError(error);
      }
    });
  },
};
