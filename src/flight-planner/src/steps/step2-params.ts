import { resetTerrain, type Step } from "../app";
import { DEFAULT_PARAMS, type PlanParams } from "../core/flightplan";
import { DRONE_CHOICES, GIMBAL_CHOICES } from "../core/qfield";
import { calculatePreview } from "../core/preview";
import { ParamsError, paramsBlocker, readParamsFile } from "../core/params";
import { download } from "../core/outputs";
import { coachLead, coachTips } from "../tutorial";
import { HINTS } from "../tutorial/content";
import { errorPanel, escapeHtml } from "./ui";
import { onFilePicked } from "./dropzone";

function option(value: string, label: string, selected: boolean): string {
  return `<wa-option value="${escapeHtml(value)}" ${selected ? "selected" : ""}>${escapeHtml(label)}</wa-option>`;
}

export const step2: Step = {
  key: "params",
  label: "Flight",

  blocker(state) {
    if (!state.aoi) return "Mark a flight area first.";
    return paramsBlocker(state.params);
  },

  render(ctx) {
    const p = ctx.state.params;
    const preview = calculatePreview(p);

    return `
      ${coachLead("params")}

      <wa-select
        id="drone-type"
        label="Drone"
        hint="${escapeHtml(HINTS.droneType)}"
        value="${escapeHtml(p.droneType)}"
      >
        ${DRONE_CHOICES.map((c) => option(c.value, c.label, c.value === p.droneType)).join("")}
      </wa-select>

      <fieldset class="detail-mode">
        <legend>How much detail?</legend>
        <p class="muted">${escapeHtml(HINTS.detailMode)}</p>
        <wa-radio-group id="detail-mode" value="${p.useGsd ? "gsd" : "agl"}" orientation="horizontal">
          <wa-radio value="gsd">Set detail (GSD)</wa-radio>
          <wa-radio value="agl">Set altitude</wa-radio>
        </wa-radio-group>

        <div class="detail-inputs">
          <wa-input
            id="gsd"
            type="number"
            label="Detail"
            hint="${escapeHtml(HINTS.gsd)}"
            value="${p.gsd}"
            min="0.3" max="20" step="0.1"
            ${p.useGsd ? "" : "disabled"}
          ><span slot="end">cm/px</span></wa-input>

          <wa-input
            id="agl"
            type="number"
            label="Altitude"
            hint="${escapeHtml(HINTS.agl)}"
            value="${p.agl}"
            min="10" max="500" step="1"
            ${p.useGsd ? "disabled" : ""}
          ><span slot="end">m</span></wa-input>
        </div>
      </fieldset>

      <div class="preview-card">
        <span class="preview-title">With these settings</span>
        <div class="stat-row">
          <div class="stat"><span class="stat-label">Flight altitude</span>
            <span class="stat-value">${preview.altitude} m</span></div>
          <div class="stat"><span class="stat-label">Line spacing</span>
            <span class="stat-value">${preview.sideSpacing} m</span></div>
          <div class="stat"><span class="stat-label">Speed</span>
            <span class="stat-value">${preview.groundSpeed} m/s</span></div>
        </div>
        <p class="muted preview-note">${escapeHtml(preview.note)}</p>
      </div>

      ${coachTips("params")}

      <wa-details summary="Overlap, flight mode and camera" appearance="outlined">
        <div class="pair">
          <wa-input id="forward-overlap" type="number" label="Forward overlap"
            hint="${escapeHtml(HINTS.forwardOverlap)}"
            value="${p.forwardOverlap}" min="0" max="99" step="1"
          ><span slot="end">%</span></wa-input>
          <wa-input id="side-overlap" type="number" label="Side overlap"
            hint="${escapeHtml(HINTS.sideOverlap)}"
            value="${p.sideOverlap}" min="0" max="99" step="1"
          ><span slot="end">%</span></wa-input>
        </div>

        <wa-select id="flight-mode" label="Flight mode"
          hint="${escapeHtml(HINTS.flightMode)}" value="${escapeHtml(p.flightMode)}">
          ${option("waylines", "Waylines (recommended)", p.flightMode === "waylines")}
          ${option("waypoints", "Every waypoint", p.flightMode === "waypoints")}
        </wa-select>

        <wa-select id="gimbal-angle" label="Camera angle"
          hint="${escapeHtml(HINTS.gimbalAngle)}" value="${escapeHtml(p.gimbalAngle)}">
          ${GIMBAL_CHOICES.map((c) => option(c.value, c.label, c.value === p.gimbalAngle)).join("")}
        </wa-select>

        <wa-input id="image-interval" type="number" label="Photo interval"
          hint="${escapeHtml(HINTS.imageInterval)}"
          value="${p.imageInterval}" min="1" max="10" step="1"
        ><span slot="end">s</span></wa-input>
      </wa-details>

      <wa-details summary="Grid rotation and takeoff" appearance="outlined">
        <wa-switch id="auto-rotation" ${p.autoRotation ? "checked" : ""}
          hint="${escapeHtml(HINTS.autoRotation)}">Rotate grid automatically</wa-switch>

        <wa-input id="rotation-angle" type="number" label="Grid angle"
          hint="${escapeHtml(HINTS.rotationAngle)}"
          value="${p.rotationAngle}" min="0" max="359" step="1"
          ${p.autoRotation ? "disabled" : ""}
        ><span slot="end">°</span></wa-input>

        <div class="takeoff-row">
          <span class="field-label">Takeoff point</span>
          <p class="muted">${escapeHtml(HINTS.takeoff)}</p>
          <div class="step-actions">
            <wa-button id="takeoff-locate" appearance="outlined" size="s">
              <wa-icon slot="start" name="location-crosshairs"></wa-icon> Use my location
            </wa-button>
            <wa-button id="takeoff-pick" appearance="outlined" size="s">
              <wa-icon slot="start" name="map-pin"></wa-icon> Tap on map
            </wa-button>
            ${
              p.takeoffPoint
                ? `<wa-button id="takeoff-clear" appearance="plain" size="s">Clear</wa-button>`
                : ""
            }
          </div>
          <p class="takeoff-value muted">
            ${
              p.takeoffPoint
                ? `Set to ${p.takeoffPoint.lat.toFixed(5)}, ${p.takeoffPoint.lon.toFixed(5)}`
                : "Not set - the plan will measure heights from the first waypoint."
            }
          </p>
        </div>
      </wa-details>

      <wa-details summary="Save or reuse these settings" appearance="outlined">
        <div class="step-actions">
          <wa-button id="params-download" appearance="outlined" size="s">
            <wa-icon slot="start" name="download"></wa-icon> Download params.json
          </wa-button>
          <wa-button id="params-reset" appearance="plain" size="s">Reset to defaults</wa-button>
        </div>
        <hot-file-input-dropzone
          id="params-drop"
          accept=".json,application/json"
          label="Drop a params.json here to reuse settings"
          variant="compact"
        ></hot-file-input-dropzone>
      </wa-details>

      <div id="params-error"></div>
    `;
  },

  mount(root, ctx) {
    const p = ctx.state.params;
    const errorHost = root.querySelector<HTMLElement>("#params-error")!;

    const changed = (rerender: boolean) => {
      ctx.state.result = null;
      ctx.map.showPlan(null, null);
      if (rerender) ctx.refresh();
    };

    const updateTakeoff = (point: PlanParams["takeoffPoint"]) => {
      p.takeoffPoint = point;
      if (point && ctx.state.dem.sampler && !ctx.state.dem.sampler.contains(point.lon, point.lat)) {
        resetTerrain(ctx.state);
      }
      ctx.map.setTakeoff(point);
      changed(true);
    };

    const bindNumber = (
      id: string,
      key: keyof PlanParams,
      { rerender = false }: { rerender?: boolean } = {},
    ) => {
      const input = root.querySelector<HTMLElement & { value: string }>(`#${id}`);
      input?.addEventListener("change", () => {
        const value = Number(input.value);
        if (!Number.isFinite(value)) return;
        (p[key] as number) = value;
        changed(rerender);
      });
    };

    const bindSelect = (id: string, key: keyof PlanParams) => {
      const select = root.querySelector<HTMLElement & { value: string }>(`#${id}`);
      select?.addEventListener("change", () => {
        (p[key] as string) = select.value;
        changed(true);
      });
    };

    bindSelect("drone-type", "droneType");
    bindSelect("flight-mode", "flightMode");
    bindSelect("gimbal-angle", "gimbalAngle");

    bindNumber("gsd", "gsd", { rerender: true });
    bindNumber("agl", "agl", { rerender: true });
    bindNumber("forward-overlap", "forwardOverlap", { rerender: true });
    bindNumber("side-overlap", "sideOverlap", { rerender: true });
    bindNumber("image-interval", "imageInterval", { rerender: true });
    bindNumber("rotation-angle", "rotationAngle");

    root.querySelector("#detail-mode")?.addEventListener("change", (event) => {
      p.useGsd = (event.target as HTMLElement & { value: string }).value === "gsd";
      changed(true);
    });

    const autoRotation = root.querySelector<HTMLElement & { checked: boolean }>("#auto-rotation");
    autoRotation?.addEventListener("change", () => {
      p.autoRotation = autoRotation.checked;
      changed(true);
    });

    root.querySelector("#takeoff-pick")?.addEventListener("click", () => {
      ctx.sheet.collapseForMap();
      ctx.map.setMode("takeoff");
      ctx.toast("Tap the map where you will launch from.");
    });

    root.querySelector("#takeoff-locate")?.addEventListener("click", async () => {
      try {
        const point = await ctx.map.locate();
        updateTakeoff(point);
        ctx.toast("Takeoff point set to your location.", "success");
      } catch (error) {
        errorHost.innerHTML = errorPanel(
          "Could not use your location.",
          error instanceof Error ? error.message : "Tap on the map instead.",
        );
      }
    });

    root.querySelector("#takeoff-clear")?.addEventListener("click", () => {
      updateTakeoff(null);
    });

    const removeMapHandler = ctx.map.onChange(() => {
      if (ctx.state.step !== 2) return;
      const point = ctx.map.takeoff();
      const same =
        (point === null && p.takeoffPoint === null) ||
        (point &&
          p.takeoffPoint &&
          point.lon === p.takeoffPoint.lon &&
          point.lat === p.takeoffPoint.lat);
      if (same) return;
      p.takeoffPoint = point;
      if (point && ctx.state.dem.sampler && !ctx.state.dem.sampler.contains(point.lon, point.lat)) {
        resetTerrain(ctx.state);
      }
      ctx.sheet.restore();
      changed(true);
    });

    root.querySelector("#params-download")?.addEventListener("click", () => {
      download({
        name: "params.json",
        data: JSON.stringify(p, null, 2),
        mime: "application/json",
        label: "params.json",
        hint: "",
      });
    });

    root.querySelector("#params-reset")?.addEventListener("click", () => {
      ctx.state.params = { ...DEFAULT_PARAMS };
      ctx.map.setTakeoff(null);
      changed(true);
    });

    onFilePicked(root.querySelector("#params-drop"), async (file) => {
      try {
        const next = await readParamsFile(file);
        if (
          next.takeoffPoint &&
          ctx.state.dem.sampler &&
          !ctx.state.dem.sampler.contains(next.takeoffPoint.lon, next.takeoffPoint.lat)
        ) {
          resetTerrain(ctx.state);
        }
        ctx.state.params = next;
        ctx.map.setTakeoff(ctx.state.params.takeoffPoint);
        errorHost.innerHTML = "";
        changed(true);
        ctx.toast("Settings loaded.", "success");
      } catch (error) {
        errorHost.innerHTML =
          error instanceof ParamsError
            ? errorPanel(error.message, error.guidance)
            : errorPanel(
                "Could not read those settings.",
                error instanceof Error ? error.message : "Fill the form in by hand.",
              );
      }
    });

    return removeMapHandler;
  },
};
