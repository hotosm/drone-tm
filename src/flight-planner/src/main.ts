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
  NO_TERRAIN,
  resetTerrain,
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
import { DEFAULT_PARAMS } from "./core/flightplan";
import { fetchParams, parseParams } from "./core/params";
import { fetchTasks, seedTaskPlans, tasksBbox } from "./core/seed";
import { mainSiteUrl, projectUrl } from "./core/http";
import {
  bboxUnion,
  DemAreaError,
  demMatchesRequest,
  DemSampler,
  fetchDem,
  planDemBbox,
  type Bbox,
} from "./core/dem";
import {
  demUsage,
  deletePlan,
  deleteStoredDem,
  detachPlanDem,
  findCoveringDem,
  getDemBytes,
  glo30DemKey,
  listDems,
  listPlans,
  newPlanId,
  planGroup,
  pruneUnusedDems,
  putDem,
  readPlanRings,
  requestPersistence,
  startupMaintenance,
  storageEstimate,
  terrainCoverage,
  UNGROUPED,
  updatePlanMeta,
  type DemEntry,
  type PlanMeta,
} from "./core/storage";
import { formatBytes, formatExtent, planLabel } from "./core/outputs";
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

const handoffHost = document.querySelector<HTMLElement>("#handoff")!;
const handoffText = document.querySelector<HTMLElement>("#handoff-text")!;
const handoffSub = document.querySelector<HTMLElement>("#handoff-sub")!;

function showHandoff(message: string, detail = ""): void {
  handoffText.textContent = message;
  handoffSub.textContent = detail;
  handoffHost.hidden = false;
}

function hideHandoff(): void {
  handoffHost.hidden = true;
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
      return true;
    } catch {
      toast("Could not save to this browser's storage.", "warning");
      return false;
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

const demBody = document.querySelector<HTMLElement>("#dems-body")!;

let planCache: PlanMeta[] = [];
let terrainReady = new Set<string>();
let planConfirming: string | null = null;
let groupConfirming: string | null = null;
let planRenaming: string | null = null;
let demConfirming: string | null = null;
const collapsedGroups = new Set<string>();
let collapseChosen = false;

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

interface PlanProject {
  key: string;
  title: string;
  plans: PlanMeta[];
  updatedAt: string;
}

function byTask(a: PlanMeta, b: PlanMeta): number {
  const left = Number(a.taskId);
  const right = Number(b.taskId);
  if (Number.isFinite(left) && Number.isFinite(right)) return left - right;
  if (Number.isFinite(left) !== Number.isFinite(right)) return Number.isFinite(left) ? -1 : 1;
  return b.updatedAt.localeCompare(a.updatedAt);
}

function projectTitle(key: string, plans: PlanMeta[]): string {
  if (key === UNGROUPED) return "Not from a project";
  const named = plans.find((plan) => plan.projectName)?.projectName;
  if (named) return named;
  const id = plans.find((plan) => plan.projectId)?.projectId ?? key;
  return `Project ${id.slice(0, 8)}`;
}

function groupByProject(plans: PlanMeta[]): PlanProject[] {
  const groups = new Map<string, PlanMeta[]>();
  for (const plan of plans) {
    const key = planGroup(plan.id);
    groups.set(key, [...(groups.get(key) ?? []), plan]);
  }

  return [...groups]
    .map(([key, list]) => ({
      key,
      title: projectTitle(key, list),
      plans: [...list].sort(byTask),
      updatedAt: list.reduce(
        (latest, plan) => (plan.updatedAt > latest ? plan.updatedAt : latest),
        "",
      ),
    }))
    .sort((a, b) => {
      if ((a.key === UNGROUPED) !== (b.key === UNGROUPED)) return a.key === UNGROUPED ? 1 : -1;
      return b.updatedAt.localeCompare(a.updatedAt);
    });
}

function projectSummary(plans: PlanMeta[]): string {
  const withTerrain = plans.filter((plan) => terrainReady.has(plan.id)).length;
  const areas = plans.length === 1 ? "1 area" : `${plans.length} areas`;
  if (withTerrain === 0) return `${areas} · no terrain yet`;
  return withTerrain === plans.length
    ? `${areas} · terrain ready`
    : `${areas} · ${withTerrain} with terrain`;
}

function chooseCollapsed(): void {
  if (collapseChosen) return;
  collapseChosen = true;
  const groups = groupByProject(planCache);
  if (groups.length < 2) return;
  const current = planGroup(state.meta.id);
  for (const group of groups) {
    if (group.key !== current && group.plans.length > 1) collapsedGroups.add(group.key);
  }
}

function planDetail(meta: PlanMeta, ready: boolean): string {
  const named = Boolean(meta.name || meta.taskId);
  const bits: string[] = [];
  if (named && meta.areaM2) bits.push(formatArea(meta.areaM2));
  bits.push(ready ? "terrain ready" : "no terrain");
  if (!meta.generatedAt) bits.push("draft");
  return bits.join(" · ");
}

function demDetail(entry: DemEntry, plans: number): string {
  return [
    formatBytes(entry.byteLength),
    formatExtent(entry.bbox),
    plans === 1 ? "1 plan" : `${plans} plans`,
  ].join(" · ");
}

function renderDemList(entries: DemEntry[], usage: Map<string, string[]>): void {
  if (entries.length === 0) {
    demBody.innerHTML = `<p class="muted">No terrain saved yet. Downloading it once covers
      the area around it, including the other tasks of a project.</p>`;
    return;
  }

  demBody.innerHTML = `<ul class="plan-list">${entries
    .map((entry) => {
      const key = escapeHtml(entry.key);
      const plans = usage.get(entry.key)?.length ?? 0;
      const confirm =
        demConfirming === entry.key
          ? `<div class="plan-confirm">
               <span>${
                 plans > 0
                   ? `Delete this terrain? ${plans === 1 ? "1 plan" : `${plans} plans`} use it.`
                   : "Delete this terrain?"
               }</span>
               <div class="plan-confirm-actions">
                 <wa-button data-dem-cancel appearance="plain" size="s">Cancel</wa-button>
                 <wa-button data-dem-delete="${key}" variant="danger" size="s">Delete</wa-button>
               </div>
             </div>`
          : "";

      return `
        <li class="plan-row" data-key="${key}">
          <div class="plan-main">
            <div class="plan-open">
              <strong class="plan-name">${escapeHtml(entry.label ?? entry.key)}</strong>
              <span class="muted plan-detail">${escapeHtml(demDetail(entry, plans))}</span>
            </div>
            <div class="plan-actions">
              <wa-button data-dem-remove="${key}" appearance="plain" size="s" title="Delete">
                <wa-icon name="trash-can" label="Delete"></wa-icon>
              </wa-button>
            </div>
          </div>
          ${confirm}
        </li>`;
    })
    .join("")}</ul>`;
}

async function refreshDemList(): Promise<void> {
  renderDemList(await listDems(), await demUsage());
}

demBody.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(
    "[data-dem-remove],[data-dem-cancel],[data-dem-delete]",
  );
  if (!target) return;
  const data = target.dataset;

  if (data.demRemove) {
    demConfirming = data.demRemove;
    return void refreshDemList();
  }

  if (data.demCancel !== undefined) {
    demConfirming = null;
    return void refreshDemList();
  }

  if (data.demDelete) {
    const key = data.demDelete;
    demConfirming = null;
    return void deleteStoredDem(key)
      .then(() => {
        if (state.dem.entry?.key === key) {
          state.dem = { ...NO_TERRAIN };
          delete state.meta.dem;
          state.result = null;
          map.showPlan(null, null);
          renderStep();
        }
        toast("Terrain deleted.", "success");
        return refreshPlanList();
      })
      .catch(() => toast("Could not delete that terrain.", "danger"));
  }
});

function renderPlanRow(meta: PlanMeta, ready: boolean): string {
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
                      Terrain only
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
          <span class="muted plan-detail">${escapeHtml(planDetail(meta, ready))}</span>
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
    ? planCache.filter((plan) =>
        `${planLabel(plan)} ${plan.projectName ?? ""}`.toLowerCase().includes(term),
      )
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

  planBody.innerHTML = groupByProject(matches)
    .map((group) => {
      const open = Boolean(term) || !collapsedGroups.has(group.key);
      const rows = group.plans
        .map((plan) => renderPlanRow(plan, terrainReady.has(plan.id)))
        .join("");

      const key = escapeHtml(group.key);
      const count = group.plans.length === 1 ? "this plan" : `all ${group.plans.length} plans`;
      const confirm =
        groupConfirming === group.key
          ? `<div class="plan-confirm">
               <span>Delete ${escapeHtml(count)} in ${escapeHtml(group.title)}?</span>
               <div class="plan-confirm-actions">
                 <wa-button data-group-cancel appearance="plain" size="s">Cancel</wa-button>
                 <wa-button data-group-delete="${key}" variant="danger" size="s">
                   Delete ${escapeHtml(group.plans.length === 1 ? "plan" : "all")}
                 </wa-button>
               </div>
             </div>`
          : "";

      return `
        <section class="plan-project">
          <div class="plan-project-bar">
            <button
              type="button"
              class="plan-project-head"
              data-group-toggle="${key}"
              aria-expanded="${open}"
            >
              <wa-icon
                class="plan-project-caret"
                name="${open ? "chevron-down" : "chevron-right"}"
              ></wa-icon>
              <span class="plan-project-heading">
                <strong>${escapeHtml(group.title)}</strong>
                <span class="muted plan-detail">${escapeHtml(projectSummary(group.plans))}</span>
              </span>
            </button>
            <wa-button
              data-group-remove="${key}"
              appearance="plain"
              size="s"
              title="Delete every plan here"
            >
              <wa-icon name="trash-can" label="Delete every plan here"></wa-icon>
            </wa-button>
          </div>
          ${confirm}
          ${open ? `<ul class="plan-list">${rows}</ul>` : ""}
        </section>`;
    })
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
  terrainReady = await terrainCoverage(planCache);
  chooseCollapsed();
  await refreshDemList();
  const estimate = await storageEstimate();
  planStorage.textContent = estimate
    ? `${planCache.length} saved · ${formatBytes(estimate.usage)} of ` +
      `${formatBytes(estimate.quota)} used`
    : `${planCache.length} saved`;
  renderPlanList();
}

async function syncProjectTasks(): Promise<void> {
  const projectId = state.meta.projectId;
  if (!projectId) return map.showTasks([]);

  const plans = (await listPlans()).filter(
    (plan) => plan.projectId === projectId && plan.id !== state.meta.id,
  );
  const rings = await readPlanRings(plans);

  const outlines = plans.flatMap((plan) => {
    const ring = rings.get(plan.id);
    return ring ? [{ planId: plan.id, label: planLabel(plan), ring }] : [];
  });
  map.showTasks(outlines);

  if (state.aoi || outlines.length === 0) return;
  const extent =
    state.projectBbox ??
    state.meta.projectBbox ??
    plans.reduce<Bbox | null>(
      (acc, plan) => (plan.bbox ? (acc ? bboxUnion(acc, plan.bbox) : [...plan.bbox]) : acc),
      null,
    );
  if (extent) map.fitBbox(extent);
}

async function loadPlanIntoState(id: string): Promise<boolean> {
  const loaded = await loadPlan(id);
  if (!loaded) return false;

  state.meta = loaded.meta;
  state.aoi = loaded.aoiRing ? validateRing(loaded.aoiRing) : null;
  if (loaded.params) state.params = parseParams(loaded.params);
  if (loaded.meta.dem && !loaded.demBytes) delete state.meta.dem;
  state.dem = { ...NO_TERRAIN };
  state.storedUpload = null;
  state.projectBbox = loaded.meta.projectBbox ?? null;
  if (loaded.demBytes && loaded.meta.dem) {
    const dem = loaded.meta.dem;
    state.dem = {
      sampler: await DemSampler.fromBytes(loaded.demBytes),
      bytes: loaded.demBytes,
      entry: { ...dem, key: dem.key ?? "" },
      fromStore: true,
      saved: true,
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
  goTo(state.dem.sampler ? 4 : state.aoi ? 3 : 1);
  await syncProjectTasks();
  return true;
}

async function openPlan(id: string): Promise<void> {
  if (!(await loadPlanIntoState(id))) return toast("That plan could not be read.", "danger");
  planDialog.open = false;
  toast("Plan loaded.", "success");
}

map.onTaskClick((planId) => {
  if (planId === state.meta.id) return;
  void openPlan(planId).catch(() => toast("That plan could not be read.", "danger"));
});

const GROUP_ACTIONS =
  "[data-group-toggle],[data-group-remove],[data-group-cancel],[data-group-delete]";

planBody.addEventListener("click", (event) => {
  const target = (event.target as HTMLElement).closest<HTMLElement>(GROUP_ACTIONS);
  if (!target) return;
  const data = target.dataset;

  if (data.groupToggle) {
    if (!collapsedGroups.delete(data.groupToggle)) collapsedGroups.add(data.groupToggle);
    return renderPlanList();
  }

  if (data.groupRemove) {
    groupConfirming = data.groupRemove;
    planConfirming = null;
    planRenaming = null;
    return renderPlanList();
  }

  if (data.groupCancel !== undefined) {
    groupConfirming = null;
    return renderPlanList();
  }

  if (data.groupDelete) {
    const key = data.groupDelete;
    groupConfirming = null;
    return void deleteProjectPlans(key)
      .then((removed) => {
        toast(`Deleted ${removed} plan${removed === 1 ? "" : "s"}.`, "success");
        return refreshPlanList();
      })
      .catch(() => toast("Those plans could not be deleted.", "danger"));
  }
});

async function deleteProjectPlans(group: string): Promise<number> {
  const doomed = planCache.filter((plan) => planGroup(plan.id) === group);
  for (const plan of doomed) await deletePlan(plan.id);

  // Crops no plan points at any more are dead weight once a project goes.
  await pruneUnusedDems();

  // Covers the plan being worked on even before its first save.
  if (planGroup(state.meta.id) === group) resetWorkspace(false);
  else await syncProjectTasks();

  return doomed.length;
}

/**
 * Clears the plan being worked on, once its own record has been deleted.
 *
 * Built from scratch rather than from initialState(), which would read the
 * project back out of the URL and hand the next save a plan to write into the
 * project that was just cleared.
 */
function resetWorkspace(keepProject: boolean): void {
  const now = new Date().toISOString();
  const { projectId, projectName } = state.meta;

  state.meta = {
    id: newPlanId(keepProject ? projectId : undefined),
    name: "",
    createdAt: now,
    updatedAt: now,
    ...(keepProject && projectId ? { projectId } : {}),
    ...(keepProject && projectName ? { projectName } : {}),
  };
  state.aoi = null;
  state.params = { ...DEFAULT_PARAMS };
  state.projectBbox = keepProject ? state.projectBbox : null;
  state.result = null;
  resetTerrain(state);

  map.clearRing();
  map.showPlan(null, null);
  map.setTakeoff(null);
  goTo(1);

  if (keepProject) {
    // Drop the task from the address bar with it: a reload would otherwise
    // restore the deleted task's identity and the next edit rewrite it.
    if (projectId) keepProjectInUrl(projectId);
    else if (location.search) history.replaceState(null, "", location.pathname);
    void syncProjectTasks();
    return;
  }

  map.showTasks([]);
  // A reload must not bring the deleted project back either.
  if (location.search) history.replaceState(null, "", location.pathname);
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
    return void detachPlanDem(id)
      .then(() => {
        if (state.meta.id === id) {
          state.dem = { ...NO_TERRAIN };
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
        // Still loaded, it would be written back by the next save.
        if (id === state.meta.id) resetWorkspace(true);
        toast("Plan deleted.", "success");
        return refreshPlanList();
      })
      .catch(() => toast("Could not delete that plan.", "danger"));
  }
});

planFilterInput.addEventListener("input", renderPlanList);

async function showStoredPlans(): Promise<void> {
  await startupMaintenance();
  planConfirming = null;
  groupConfirming = null;
  planRenaming = null;
  demConfirming = null;
  planFilterInput.value = "";
  await refreshPlanList();
  planDialog.open = true;
}

async function seedProjectTerrain(bbox: Bbox): Promise<string> {
  // A crop already on disk only counts if it still reads back and reaches the
  // whole project; otherwise fall through and fetch it again.
  if (await heldTerrainCovers(bbox)) return "Terrain for this project was already saved.";

  const plan = planDemBbox({ required: bbox, context: bbox });

  const estimate = await storageEstimate();
  if (estimate && plan.bytes > estimate.quota - estimate.usage) {
    throw new Error(
      `The task areas are saved, but terrain needs about ${formatBytes(plan.bytes)} ` +
        `and this browser has room for ${formatBytes(estimate.quota - estimate.usage)}.`,
    );
  }

  showHandoff("Downloading terrain for this project", `About ${formatBytes(plan.bytes)}`);
  const { bytes, url, snapped } = await fetchDem(plan.bbox);

  const sampler = await DemSampler.fromBytes(bytes);
  // Validate the returned raster itself, not only its metadata.
  if (!sampler.covers(plan.bbox, 0)) {
    throw new Error("The elevation service returned a crop smaller than this project.");
  }
  if (!demMatchesRequest(sampler, snapped)) {
    const got = sampler.size();
    throw new Error(
      `The elevation service returned a ${got.width}x${got.height} grid, not the ` +
        `${snapped.width}x${snapped.height} that was asked for.`,
    );
  }
  const relief = sampler.range();
  if (relief.voids === relief.count) {
    throw new Error("The terrain for this project came back empty.");
  }

  await putDem(
    {
      key: glo30DemKey(snapped.bbox),
      bbox: snapped.bbox,
      width: snapped.width,
      height: snapped.height,
      sourceUrl: url,
      fetchedAt: new Date().toISOString(),
      byteLength: bytes.byteLength,
      source: "GLO30",
      label: plan.clamped ? `${formatExtent(snapped.bbox)} of this project` : "This whole project",
    },
    bytes,
  );
  const persisted = await requestPersistence();
  const kept = persisted
    ? "Every task can now be planned offline."
    : "Every task can now be planned offline, as long as this browser keeps its storage.";

  return plan.clamped
    ? `Terrain saved for ${formatExtent(snapped.bbox)} of this project. Tasks outside that ` +
        `need their own download, while you still have a signal.`
    : `Terrain saved for the whole project. ${kept}`;
}

async function applyTaskSeeding(tasksUrl: string, projectId: string | null): Promise<void> {
  if (!projectId) {
    toast("That link is missing its project.", "warning");
    return;
  }

  try {
    showHandoff("Loading the task areas");
    const { tasks, unreadable } = await fetchTasks(tasksUrl);
    const bbox = state.projectBbox ?? tasksBbox(tasks);

    showHandoff("Saving the task areas for offline use", `0 of ${tasks.length}`);
    const { added, updated, kept } = await seedTaskPlans({
      projectId,
      projectName: state.meta.projectName,
      tasks,
      params: state.params,
      projectBbox: bbox,
      onProgress: (written, total) => {
        handoffSub.textContent = `${written} of ${total}`;
      },
    });

    state.projectBbox = bbox;
    state.meta.projectBbox = bbox;

    toast(seedSummary({ added, updated, kept }), "success");
    if (unreadable > 0) {
      toast(
        `${unreadable} of the project's areas could not be read and were not saved. ` +
          `Draw those by hand, or ask for the project to be checked.`,
        "warning",
      );
    }

    try {
      toast(await seedProjectTerrain(bbox), "success");
    } catch (error) {
      const guidance = error instanceof DemAreaError ? ` ${error.guidance}` : "";
      toast(
        `${error instanceof Error ? error.message : "Terrain could not be downloaded."}` +
          `${guidance} You can still download it from step 3 of any task.`,
        "warning",
      );
    }

    keepProjectInUrl(projectId);
    map.fitBbox(bbox);
    await showStoredPlans();
  } catch (error) {
    toast(error instanceof Error ? error.message : "Could not load the task areas.", "warning");
  }
}

async function heldTerrainCovers(bbox: Bbox): Promise<boolean> {
  const entry = await findCoveringDem(bbox);
  if (!entry) return false;

  const bytes = await getDemBytes(entry.key);
  if (!bytes) return false;

  try {
    return (await DemSampler.fromBytes(bytes)).covers(bbox, 0);
  } catch {
    return false;
  }
}

function seedSummary({
  added,
  updated,
  kept,
}: {
  added: number;
  updated: number;
  kept: number;
}): string {
  const parts: string[] = [];
  if (added > 0) parts.push(`Saved ${added} task${added === 1 ? "" : "s"} for offline use`);
  if (updated > 0)
    parts.push(`${added > 0 ? "refreshed" : "Refreshed"} ${updated} from the project`);
  if (kept > 0) parts.push(`left ${kept} you have already worked on untouched`);
  if (parts.length === 0) return "This project is already saved for offline use.";
  return `${parts.join(", ")}.`;
}

function keepProjectInUrl(projectId: string): void {
  const kept = new URLSearchParams({ project: projectId });
  if (state.meta.projectName) kept.set("project_name", state.meta.projectName);
  if (state.meta.taskId) kept.set("task", state.meta.taskId);
  history.replaceState(null, "", `${location.pathname}?${kept.toString()}`);
}

const HANDOFF_PARAMS = ["aoi", "params", "project_aoi", "tasks"];

function hasHandoff(): boolean {
  const search = new URLSearchParams(location.search);
  return HANDOFF_PARAMS.some((key) => search.has(key));
}

function fromDroneTm(): boolean {
  return new URLSearchParams(location.search).has("project");
}

async function applyUrlHandoff(): Promise<void> {
  if (!hasHandoff()) return;
  showHandoff("Loading this project");
  try {
    await runUrlHandoff();
  } finally {
    hideHandoff();
  }
}

async function runUrlHandoff(): Promise<void> {
  const search = new URLSearchParams(location.search);
  const aoiUrl = search.get("aoi");
  const paramsUrl = search.get("params");
  const projectAoiUrl = search.get("project_aoi");
  const tasksUrl = search.get("tasks");
  const projectId = search.get("project");
  const taskId = search.get("task");

  if (projectId && taskId && !tasksUrl) {
    const held = (await listPlans()).find(
      (plan) => plan.projectId === projectId && plan.taskId === taskId,
    );
    if (held && (await loadPlanIntoState(held.id))) {
      state.meta.projectName = search.get("project_name") ?? state.meta.projectName;
    }
  }

  if (projectAoiUrl) {
    try {
      const project = await fetchAoi(projectAoiUrl);
      state.projectBbox = project.bbox;
      state.meta.projectBbox = project.bbox;
    } catch {
      /* Fall back to the default DEM radius. */
    }
  }

  let aoiFailed = false;
  if (aoiUrl) {
    try {
      const aoi = await fetchAoi(aoiUrl);
      state.aoi = aoi;
      map.setRing(aoi.ring);
      map.fitBbox(aoi.bbox);
      state.step = 2;
    } catch (error) {
      aoiFailed = true;
      toast(error instanceof Error ? error.message : "Could not load the area.", "warning");
    }
  }

  let paramsFailed = false;
  if (paramsUrl) {
    try {
      state.params = await fetchParams(paramsUrl);
      map.setTakeoff(state.params.takeoffPoint);
      if (state.aoi) state.step = 3;
    } catch (error) {
      paramsFailed = true;
      toast(error instanceof Error ? error.message : "Could not load the settings.", "warning");
    }
  }

  if (tasksUrl) {
    // Do not seed tasks with defaults when project settings fail.
    if (paramsFailed) {
      toast(
        "Nothing was saved offline - the project's flight settings could not be read.",
        "danger",
      );
      return;
    }
    await applyTaskSeeding(tasksUrl, projectId);
    return;
  }

  await context.save();
  // Keep a failed fetch in the URL: trimming it would strand an empty task
  // with no way to retry but drawing the area by hand.
  if (projectId && !aoiFailed && !paramsFailed) keepProjectInUrl(projectId);
  renderStep();
}

initTutorialAttribute();
syncTutorialToggle();

document.querySelector("#tutorial-toggle")?.addEventListener("change", (event) => {
  setTutorialEnabled((event.target as HTMLElement & { checked: boolean }).checked);
  renderStep();
});

function wireMainSite(): void {
  const button = document.querySelector<HTMLElement>("#main-site");
  if (!button) return;

  const projectId = state.meta.projectId;
  button.setAttribute("href", projectId ? projectUrl(projectId) : mainSiteUrl());

  if (!projectId) {
    button.setAttribute("target", "_blank");
    return;
  }

  const label = document.querySelector<HTMLElement>("#main-site-label");
  if (label) label.textContent = "Back to project";
  const icon = document.querySelector<HTMLElement>("#main-site-icon");
  icon?.setAttribute("slot", "start");
  icon?.setAttribute("name", "arrow-left");
  icon?.setAttribute("label", "Back to project");
}

wireMainSite();

document.querySelector("#show-plans")?.addEventListener("click", () => void showStoredPlans());
document.querySelector("#show-help")?.addEventListener("click", showWelcome);

renderStep();

if (!fromDroneTm() && !welcomeSeen() && tutorialEnabled()) showWelcome();

if (hasHandoff()) showHandoff("Loading this project");

void startupMaintenance()
  .then(applyUrlHandoff)
  .then(syncProjectTasks)
  .catch(() => {});

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
