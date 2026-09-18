import "@hotosm/ui/dist/style.css";
import "@hotosm/ui/dist/webawesome-all.js";
import "@hotosm/ui/dist/hotosm-ui.js";
import "maplibre-gl/dist/maplibre-gl.css";
import "@mapbox/mapbox-gl-draw/dist/mapbox-gl-draw.css";
import "./styles/app.css";

import { createMap } from "./map";
import { createSheet } from "./sheet";
import {
  initialState,
  loadPlan,
  savePlan,
  TOTAL_STEPS,
  type AppState,
  type Step,
  type StepContext,
} from "./app";
import { step1 } from "./steps/step1-area";
import { step2 } from "./steps/step2-params";
import { step3 } from "./steps/step3-dem";
import { step4 } from "./steps/step4-generate";
import { escapeHtml } from "./steps/ui";
import { fetchAoi, formatArea, validateRing } from "./core/aoi";
import { fetchParams, parseParams } from "./core/params";
import { DemSampler } from "./core/dem";
import {
  deleteDem,
  deletePlan,
  listPlans,
  pruneEmptyPlans,
  storageEstimate,
  updatePlanMeta,
  type PlanMeta,
} from "./core/storage";
import { formatBytes, planLabel } from "./core/outputs";
import {
  initTutorialAttribute,
  markWelcomeSeen,
  setTutorialEnabled,
  tutorialEnabled,
  welcomeSeen,
} from "./tutorial";
import { WELCOME } from "./tutorial/content";

const STEPS: Step[] = [step1, step2, step3, step4];

const state: AppState = initialState();

const stepHost = document.querySelector<HTMLElement>("#step-body")!;
const railHost = document.querySelector<HTMLElement>("#step-rail")!;
const titleHost = document.querySelector<HTMLElement>("#step-title")!;
const navHost = document.querySelector<HTMLElement>("#step-nav")!;
const toastHost = document.querySelector<HTMLElement>("#toasts")!;
const mapHost = document.querySelector<HTMLElement>("#map")!;
const paneHost = document.querySelector<HTMLElement>("#wizard-pane")!;
const handleHost = document.querySelector<HTMLElement>("#sheet-handle")!;

const map = createMap(mapHost);

const sheet = createSheet(paneHost, handleHost, () => {
  if (state.aoi && sheet.detent() !== "full") map.fitBbox(state.aoi.bbox);
});

function renderRail(): void {
  railHost.innerHTML = STEPS.map((step, index) => {
    const number = index + 1;
    const done = number < state.step;
    const current = number === state.step;
    return `
      <button
        class="rail-step ${current ? "current" : ""} ${done ? "done" : ""}"
        data-step="${number}"
        ${current ? 'aria-current="step"' : ""}
      >
        <span class="rail-dot">${done ? "&check;" : number}</span>
        <span class="rail-label">${escapeHtml(step.label)}</span>
      </button>`;
  }).join("");

  for (const button of railHost.querySelectorAll<HTMLElement>(".rail-step")) {
    button.addEventListener("click", () => {
      const target = Number(button.dataset.step);
      if (target <= state.step) return goTo(target);
      for (let step = state.step; step < target; step++) {
        const blocker = STEPS[step - 1].blocker(state);
        if (blocker) return toast(blocker, "warning");
      }
      goTo(target);
    });
  }
}

function renderNav(): void {
  const step = STEPS[state.step - 1];
  const blocker = step.blocker(state);
  const isLast = state.step === TOTAL_STEPS;

  navHost.innerHTML = `
    ${
      state.step > 1
        ? `<wa-button id="nav-back" appearance="outlined" size="l">
             <wa-icon slot="start" name="arrow-left"></wa-icon> Back
           </wa-button>`
        : "<span></span>"
    }
    ${
      isLast
        ? ""
        : `<wa-button id="nav-next" variant="brand" size="l" ${blocker ? "disabled" : ""}>
             Next <wa-icon slot="end" name="arrow-right"></wa-icon>
           </wa-button>`
    }`;

  navHost.querySelector("#nav-back")?.addEventListener("click", () => goTo(state.step - 1));
  navHost.querySelector("#nav-next")?.addEventListener("click", () => goTo(state.step + 1));

  const hint = document.querySelector<HTMLElement>("#nav-hint")!;
  hint.textContent = !isLast && blocker ? blocker : "";
}

let unmountStep: (() => void) | undefined;

function renderStep(): void {
  unmountStep?.();
  unmountStep = undefined;
  const step = STEPS[state.step - 1];
  titleHost.textContent = `Step ${state.step} of ${TOTAL_STEPS}`;
  stepHost.innerHTML = step.render(context);
  unmountStep = step.mount(stepHost, context) || undefined;
  renderRail();
  renderNav();
  stepHost.scrollTop = 0;
  sheet.remeasure();
}

function goTo(step: number): void {
  if (step < 1 || step > TOTAL_STEPS) return;
  state.step = step;
  renderStep();
  void savePlan(state, false).catch(() =>
    toast("Could not save to this browser's storage.", "warning"),
  );
}

function toast(
  message: string,
  variant: "brand" | "success" | "warning" | "danger" = "brand",
): void {
  const element = document.createElement("wa-callout");
  element.setAttribute("variant", variant);
  element.setAttribute("appearance", "filled");
  element.setAttribute("size", "s");
  element.className = "toast";
  element.textContent = message;
  toastHost.append(element);
  setTimeout(() => {
    element.classList.add("leaving");
    setTimeout(() => element.remove(), 300);
  }, 4000);
}

const context: StepContext = {
  state,
  map,
  refresh: renderStep,
  goTo,
  toast,
  async save(writeDem = false) {
    try {
      await savePlan(state, writeDem);
    } catch {
      toast("Could not save to this browser's storage.", "warning");
    }
  },
  sheet,
};

function showWelcome(): void {
  const dialog = document.querySelector<HTMLElement & { open: boolean }>("#welcome")!;
  dialog.querySelector("#welcome-body")!.innerHTML = `
    <p class="welcome-lead">${escapeHtml(WELCOME.lead)}</p>
    <ol class="welcome-steps">
      ${WELCOME.steps
        .map(
          (step, index) => `
        <li>
          <span class="welcome-num">${index + 1}</span>
          <div>
            <strong>${escapeHtml(step.title)}</strong>
            <span class="muted">${escapeHtml(step.detail)}</span>
          </div>
        </li>`,
        )
        .join("")}
    </ol>
    <wa-callout variant="brand" appearance="outlined" size="s">
      <wa-icon slot="icon" name="wifi"></wa-icon>
      ${escapeHtml(WELCOME.offlineNote)}
    </wa-callout>`;

  dialog.querySelector("#welcome-start")?.addEventListener("click", () => {
    markWelcomeSeen();
    dialog.open = false;
  });
  dialog.querySelector("#welcome-skip")?.addEventListener("click", () => {
    markWelcomeSeen();
    setTutorialEnabled(false);
    dialog.open = false;
    renderStep();
    syncTutorialToggle();
  });
  dialog.open = true;
}

function syncTutorialToggle(): void {
  const toggle = document.querySelector<HTMLElement & { checked: boolean }>("#tutorial-toggle");
  if (toggle) toggle.checked = tutorialEnabled();
}

const planDialog = document.querySelector<HTMLElement & { open: boolean }>("#plans")!;
const planBody = document.querySelector<HTMLElement>("#plans-body")!;
const planStorage = document.querySelector<HTMLElement>("#plans-storage")!;
const planFilterInput = document.querySelector<HTMLElement & { value: string }>("#plans-filter")!;

let planCache: PlanMeta[] = [];
let planConfirming: string | null = null;
let planRenaming: string | null = null;

const DAY_MS = 24 * 60 * 60 * 1000;

const PLAN_ACTIONS = [
  "[data-load]",
  "[data-rename]",
  "[data-rename-save]",
  "[data-rename-cancel]",
  "[data-remove]",
  "[data-cancel]",
  "[data-delete]",
  "[data-free]",
].join(",");

function planGroup(meta: PlanMeta): string {
  const age = Date.now() - Date.parse(meta.updatedAt);
  if (!Number.isFinite(age)) return "Older";
  if (age < DAY_MS) return "Today";
  if (age < 7 * DAY_MS) return "This week";
  return "Older";
}

function planDetail(meta: PlanMeta): string {
  const named = Boolean(meta.name || meta.taskId);
  const bits: string[] = [];
  if (named && meta.areaM2) bits.push(formatArea(meta.areaM2));
  bits.push(meta.dem ? `terrain ${formatBytes(meta.dem.byteLength)}` : "no terrain");
  if (!meta.generatedAt) bits.push("draft");
  return bits.join(" · ");
}

function renderPlanRow(meta: PlanMeta): string {
  const id = escapeHtml(meta.id);

  if (planRenaming === meta.id) {
    return `
      <li class="plan-row" data-id="${id}">
        <div class="plan-rename">
          <wa-input
            id="plan-rename-input"
            size="s"
            value="${escapeHtml(meta.name)}"
            placeholder="${escapeHtml(planLabel(meta))}"
            autocomplete="off"
          ></wa-input>
          <div class="plan-rename-actions">
            <wa-button data-rename-cancel appearance="plain" size="s">Cancel</wa-button>
            <wa-button data-rename-save="${id}" variant="brand" size="s">Save</wa-button>
          </div>
        </div>
      </li>`;
  }

  const confirm =
    planConfirming === meta.id
      ? `<div class="plan-confirm">
           <span>Delete this plan?</span>
           <div class="plan-confirm-actions">
             <wa-button data-cancel appearance="plain" size="s">Cancel</wa-button>
             ${
               meta.dem
                 ? `<wa-button data-free="${id}" appearance="outlined" size="s">
                      Terrain only (${escapeHtml(formatBytes(meta.dem.byteLength))})
                    </wa-button>`
                 : ""
             }
             <wa-button data-delete="${id}" variant="danger" size="s">Delete plan</wa-button>
           </div>
         </div>`
      : "";

  return `
    <li class="plan-row ${meta.id === state.meta.id ? "current" : ""}" data-id="${id}">
      <div class="plan-main">
        <button class="plan-open" data-load="${id}">
          <strong class="plan-name">${escapeHtml(planLabel(meta))}</strong>
          <span class="muted plan-detail">${escapeHtml(planDetail(meta))}</span>
        </button>
        <div class="plan-actions">
          <wa-button data-rename="${id}" appearance="plain" size="s" title="Rename">
            <wa-icon name="pen" label="Rename"></wa-icon>
          </wa-button>
          <wa-button data-remove="${id}" appearance="plain" size="s" title="Delete">
            <wa-icon name="trash-can" label="Delete"></wa-icon>
          </wa-button>
        </div>
      </div>
      ${confirm}
    </li>`;
}

function renderPlanList(): void {
  const term = planFilterInput.value.trim().toLowerCase();
  const matches = term
    ? planCache.filter((plan) => planLabel(plan).toLowerCase().includes(term))
    : planCache;

  if (planCache.length === 0) {
    planBody.innerHTML = `<p class="muted">No saved plans yet. One appears here as soon as
      you mark an area.</p>`;
    return;
  }

  if (matches.length === 0) {
    planBody.innerHTML = `<p class="muted">Nothing matches "${escapeHtml(term)}".</p>`;
    return;
  }

  const groups = new Map<string, PlanMeta[]>();
  for (const plan of matches) {
    const key = planGroup(plan);
    groups.set(key, [...(groups.get(key) ?? []), plan]);
  }

  planBody.innerHTML = [...groups]
    .map(
      ([heading, plans]) => `
        <h3 class="plan-group">${escapeHtml(heading)}</h3>
        <ul class="plan-list">${plans.map(renderPlanRow).join("")}</ul>`,
    )
    .join("");

  if (planRenaming) focusRenameInput();
}

// Wait for Lit to create the input's shadow root before focusing it.
function focusRenameInput(): void {
  const input = planBody.querySelector<HTMLElement & { updateComplete?: Promise<unknown> }>(
    "#plan-rename-input",
  );
  if (!input) return;
  void Promise.resolve(input.updateComplete).then(() => input.focus());
}

async function refreshPlanList(): Promise<void> {
  planCache = await listPlans();
  const estimate = await storageEstimate();
  planStorage.textContent = estimate
    ? `${planCache.length} saved · ${formatBytes(estimate.usage)} of ` +
      `${formatBytes(estimate.quota)} used`
    : `${planCache.length} saved`;
  renderPlanList();
}

async function openPlan(id: string): Promise<void> {
  const loaded = await loadPlan(id);
  if (!loaded) return toast("That plan could not be read.", "danger");

  state.meta = loaded.meta;
  state.aoi = loaded.aoiRing ? validateRing(loaded.aoiRing) : null;
  if (loaded.params) state.params = parseParams(loaded.params);
  if (loaded.meta.dem && !loaded.demBytes) delete state.meta.dem;
  state.dem = { sampler: null, snapped: null, bytes: null, source: null, skipped: false };
  if (loaded.demBytes) {
    state.dem = {
      sampler: await DemSampler.fromBytes(loaded.demBytes),
      snapped:
        loaded.meta.dem?.source === "GLO30"
          ? {
              bbox: loaded.meta.dem.bbox,
              width: loaded.meta.dem.width,
              height: loaded.meta.dem.height,
            }
          : null,
      bytes: loaded.demBytes,
      source: loaded.meta.dem?.source ?? null,
      skipped: false,
    };
  }
  state.result = null;
  if (state.aoi) {
    map.setRing(state.aoi.ring);
    map.fitBbox(state.aoi.bbox);
  } else {
    map.clearRing();
  }
  map.showPlan(null, null);
  map.setTakeoff(state.params.takeoffPoint);
  planDialog.open = false;
  goTo(state.dem.sampler ? 4 : state.aoi ? 3 : 1);
  toast("Plan loaded.", "success");
}

planBody.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(PLAN_ACTIONS);
  if (!target) return;
  const data = target.dataset;

  if (data.load) {
    return void openPlan(data.load).catch((error) =>
      toast(error instanceof Error ? error.message : "That plan could not be read.", "danger"),
    );
  }

  if (data.rename) {
    planRenaming = data.rename;
    planConfirming = null;
    return renderPlanList();
  }

  if (data.renameCancel !== undefined) {
    planRenaming = null;
    return renderPlanList();
  }

  if (data.renameSave) {
    const input = planBody.querySelector<HTMLElement & { value: string }>("#plan-rename-input");
    const name = (input?.value ?? "").trim();
    const id = data.renameSave;
    planRenaming = null;
    return void updatePlanMeta(id, (meta) => {
      meta.name = name;
    })
      .then(() => {
        if (state.meta.id === id) state.meta.name = name;
        return refreshPlanList();
      })
      .catch(() => toast("Could not rename that plan.", "danger"));
  }

  if (data.remove) {
    planConfirming = data.remove;
    planRenaming = null;
    return renderPlanList();
  }

  if (data.cancel !== undefined) {
    planConfirming = null;
    return renderPlanList();
  }

  if (data.free) {
    const id = data.free;
    planConfirming = null;
    return void deleteDem(id)
      .then(() => {
        if (state.meta.id === id) {
          state.dem = { sampler: null, snapped: null, bytes: null, source: null, skipped: false };
          delete state.meta.dem;
          state.result = null;
          map.showPlan(null, null);
          renderStep();
        }
        toast("Terrain freed. Download it again when you have a signal.", "success");
        return refreshPlanList();
      })
      .catch(() => toast("Could not free that terrain.", "danger"));
  }

  if (data.delete) {
    const id = data.delete;
    planConfirming = null;
    return void deletePlan(id)
      .then(() => {
        toast("Plan deleted.", "success");
        return refreshPlanList();
      })
      .catch(() => toast("Could not delete that plan.", "danger"));
  }
});

planFilterInput.addEventListener("input", renderPlanList);

async function showStoredPlans(): Promise<void> {
  planConfirming = null;
  planRenaming = null;
  planFilterInput.value = "";
  await refreshPlanList();
  planDialog.open = true;
}

async function applyUrlHandoff(): Promise<void> {
  const search = new URLSearchParams(location.search);
  const aoiUrl = search.get("aoi");
  const paramsUrl = search.get("params");
  if (!aoiUrl && !paramsUrl) return;

  if (aoiUrl) {
    try {
      const aoi = await fetchAoi(aoiUrl);
      state.aoi = aoi;
      map.setRing(aoi.ring);
      map.fitBbox(aoi.bbox);
      state.step = 2;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not load the area.", "warning");
    }
  }

  if (paramsUrl) {
    try {
      state.params = await fetchParams(paramsUrl);
      map.setTakeoff(state.params.takeoffPoint);
      if (state.aoi) state.step = 3;
    } catch (error) {
      toast(error instanceof Error ? error.message : "Could not load the settings.", "warning");
    }
  }

  await context.save();
  renderStep();
}

initTutorialAttribute();
syncTutorialToggle();

document.querySelector("#tutorial-toggle")?.addEventListener("change", (event) => {
  setTutorialEnabled((event.target as HTMLElement & { checked: boolean }).checked);
  renderStep();
});

const mainSite = import.meta.env.VITE_MAIN_SITE_URL || "https://drone.hotosm.org";
document.querySelector("#main-site")?.setAttribute("href", mainSite);

document.querySelector("#show-plans")?.addEventListener("click", () => void showStoredPlans());
document.querySelector("#show-help")?.addEventListener("click", showWelcome);

renderStep();

if (!welcomeSeen() && tutorialEnabled()) showWelcome();

void applyUrlHandoff();

void pruneEmptyPlans().catch(() => {});

const headerHost = document.querySelector<HTMLElement>(".app-header")!;

function syncChromeHeight(): void {
  const bottom = Math.round(headerHost.getBoundingClientRect().bottom);
  document.documentElement.style.setProperty("--app-chrome-h", `${bottom}px`);
}

new ResizeObserver(syncChromeHeight).observe(headerHost);
syncChromeHeight();

function syncOnlineState(): void {
  document.documentElement.dataset.online = navigator.onLine ? "yes" : "no";
  const banner = document.querySelector<HTMLElement>("#offline-banner");
  if (banner) banner.hidden = navigator.onLine;
  syncChromeHeight();
}
window.addEventListener("online", syncOnlineState);
window.addEventListener("offline", syncOnlineState);
syncOnlineState();
