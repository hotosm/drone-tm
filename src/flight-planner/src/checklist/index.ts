import type { AppState, StepContext } from "../app";
import {
  departComplete,
  failedItems,
  stageByKey,
  stageItems,
  stageProgress,
  visibleItems,
  withAnswer,
  readChecklist,
  withoutStage,
  withUnansweredOk,
  type Answer,
  type ChecklistState,
  type ChecklistStatus,
} from "../core/checklist";
import type { DroneTypeKey } from "../core/types";
import { escapeHtml } from "../steps/ui";
import { tutorialEnabled } from "../tutorial";
import {
  EMERGENCIES,
  IN_FLIGHT,
  IN_FLIGHT_STEPS,
  NOT_OK_MESSAGE,
  STAGES,
  type ChecklistGroup,
  type ChecklistItem,
  type ChecklistStage,
  type StageKey,
} from "./content";

type Dialog = HTMLElement & { open: boolean; label: string };

const STATUS_LABEL: Record<ChecklistStatus, string> = {
  stop: "Do not fly",
  todo: "Not finished",
  caution: "Done, with warnings",
  ready: "Done",
};

const STORAGE_KEY = "dtm.checklist";

function loadChecklist(): ChecklistState {
  try {
    return readChecklist(localStorage.getItem(STORAGE_KEY));
  } catch {
    return readChecklist(null);
  }
}

function saveChecklist(ctx: StepContext, next: ChecklistState): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
  } catch {
    ctx.toast("Could not save the checklist to this browser's storage.", "warning");
  }
}

function blockingItems(state: AppState): ChecklistItem[] {
  const checklist = loadChecklist();
  return STAGES.flatMap((stage) => failedItems(stage, checklist, state.params.droneType)).filter(
    (item) => item.severity === "stop",
  );
}

function problemCallout(state: AppState): string {
  const items = blockingItems(state);
  if (items.length === 0) return "";
  return `
    <wa-callout variant="danger" appearance="outlined">
      <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
      <strong>Do not fly until these are OK:</strong>
      <ul>${items.map((item) => `<li>${escapeHtml(item.label)}</li>`).join("")}</ul>
    </wa-callout>`;
}

/**
 * Marks the header button while any answer is Not OK, or the pre-departure
 * checks are unfinished, so it is seen from every step.
 */
export function renderChecklistStatus(state: AppState): void {
  const unfinished = !departComplete(loadChecklist(), state.params.droneType);
  const status = blockingItems(state).length > 0 ? "stop" : unfinished ? "todo" : null;
  const dot = document.querySelector<HTMLElement>("#checklist-status")!;
  dot.hidden = !status;
  if (!status) return;
  dot.dataset.status = status;
  dot.setAttribute("aria-label", STATUS_LABEL[status]);
}

// The pre-departure checks hold for the day; the others are redone each flight.
const RESET_LABEL: Partial<Record<StageKey, string>> = {
  site: "Start again",
  next: "Start next flight",
};

type OpenStage = (key: StageKey, reference?: boolean) => void;

const MINUTE_MS = 60 * 1000;

// Shows a repeat-flight pilot whether "Done" is from this flight or the last one.
function checkedAgo(checkedAt: number | undefined): string {
  if (checkedAt === undefined) return "";
  const minutes = Math.round((Date.now() - checkedAt) / MINUTE_MS);
  if (minutes < 1) return ", just now";
  if (minutes < 60) return `, ${minutes} min ago`;
  return `, ${Math.floor(minutes / 60)} h ago`;
}

function stageRow(
  stage: ChecklistStage,
  checklist: ChecklistState,
  droneType: DroneTypeKey,
  variant: "brand" | "neutral" = "neutral",
): string {
  const { status, answered, total } = stageProgress(stage, checklist, droneType);
  const resetLabel = RESET_LABEL[stage.key];
  const age = resetLabel ? checkedAgo(checklist.checkedAt[stage.key]) : "";
  const reset =
    resetLabel && answered > 0
      ? `<wa-button data-checklist-reset="${stage.key}" appearance="plain" size="s">
           ${resetLabel}
         </wa-button>`
      : "";
  return `
    <div class="download-row">
      <div class="download-meta">
        <strong>${escapeHtml(stage.title)}</strong>
        <span class="muted">${answered} of ${total} checked - ${STATUS_LABEL[status]}${age}</span>
      </div>
      <div class="checklist-actions">
        ${reset}
        <wa-button data-checklist-open="${stage.key}" variant="${variant}" size="s"
          appearance="${variant === "brand" ? "accent" : "outlined"}">
          ${answered === 0 ? "Start" : "Open"}
        </wa-button>
      </div>
    </div>`;
}

const IN_FLIGHT_ROW = `
  <div class="download-row">
    <div class="download-meta">
      <strong>${IN_FLIGHT.title}</strong>
      <span class="muted">${IN_FLIGHT.hint}</span>
    </div>
    <wa-button data-checklist-reference appearance="outlined" size="s">Open</wa-button>
  </div>`;

function checklistOverview(state: AppState): string {
  const checklist = loadChecklist();
  // In the order they happen, with the in-flight guide after the checks it follows.
  const rows = STAGES.map(
    (stage) =>
      stageRow(stage, checklist, state.params.droneType) +
      (stage.key === "site" ? IN_FLIGHT_ROW : ""),
  ).join("");

  return `
    ${problemCallout(state)}
    <div class="downloads">${rows}</div>`;
}

// Next to the plan, only what is done for each flight. Project checks are in the header.
function cardBody(state: AppState): string {
  const site = stageRow(stageByKey("site"), loadChecklist(), state.params.droneType, "brand");
  return `
    ${problemCallout(state)}
    <div class="downloads">${site}${IN_FLIGHT_ROW}</div>
    <p class="muted">
      "Before you leave" and repeat flight checks are in the header, under the clipboard icon.
    </p>`;
}

export function checklistCard(state: AppState): string {
  return `
    <h3 class="downloads-title">Flight checklist</h3>
    <div data-checklist-card>${cardBody(state)}</div>`;
}

// Redraws only what shows answers, so the step keeps its scroll position.
function refreshChecklistViews(ctx: StepContext): void {
  renderChecklistStatus(ctx.state);
  const card = document.querySelector<HTMLElement>("[data-checklist-card]");
  if (!card) return;
  card.innerHTML = cardBody(ctx.state);
  mountChecklistCard(card, ctx);
}

export function mountChecklistCard(
  root: HTMLElement,
  ctx: StepContext,
  open: OpenStage = (key, reference) => void openChecklist(ctx, key, reference),
): void {
  for (const button of root.querySelectorAll<HTMLElement>("[data-checklist-open]")) {
    button.addEventListener("click", () => open(button.dataset.checklistOpen as StageKey));
  }
  for (const button of root.querySelectorAll<HTMLElement>("[data-checklist-reset]")) {
    const stage = stageByKey(button.dataset.checklistReset as StageKey);
    button.addEventListener("click", () => {
      saveChecklist(ctx, withoutStage(loadChecklist(), stage));
      open(stage.key);
    });
  }
  root
    .querySelector("[data-checklist-reference]")
    ?.addEventListener("click", () => open("site", true));
}

// Downloads are never blocked, so this is where the pre-flight checks are asked for.
export function promptSiteChecks(ctx: StepContext): void {
  const stage = stageByKey("site");
  const { status } = stageProgress(stage, loadChecklist(), ctx.state.params.droneType);
  if (status === "ready" || status === "caution") return;
  ctx.toast(`Once the plan is on the controller, do the "${stage.title}" checks.`);
}

function notOkMessage(item: ChecklistItem, answer: Answer | undefined): string {
  if (answer !== "not_ok") return "";
  return `<p class="checklist-not-ok" role="alert">${NOT_OK_MESSAGE[item.severity]}</p>`;
}

// Safety notes always show. Image quality notes only show with the guide on.
function showWhy(item: ChecklistItem): boolean {
  return Boolean(item.why) && (item.severity !== "advise" || tutorialEnabled());
}

// A radio group per item keeps keyboard focus and announces the selection.
function itemRow(item: ChecklistItem, answer: Answer | undefined): string {
  return `
    <li>
      <wa-radio-group
        data-item="${item.id}"
        label="${escapeHtml(item.label)}"
        orientation="horizontal"
        value="${answer ?? ""}"
      >
        <wa-radio appearance="button" value="ok">OK</wa-radio>
        <wa-radio appearance="button" value="not_ok">Not OK</wa-radio>
      </wa-radio-group>
      ${showWhy(item) ? `<p class="muted checklist-why">${escapeHtml(item.why!)}</p>` : ""}
      <div data-not-ok="${item.id}">${notOkMessage(item, answer)}</div>
    </li>`;
}

function groupPage(group: ChecklistGroup, state: AppState): string {
  const { answers } = loadChecklist();
  const items = visibleItems(group.items, state.params.droneType);
  // Below the items, so the pilot has scrolled past each one before using it.
  const allOk = items.some((item) => !answers[item.id])
    ? `<wa-button data-all-ok appearance="outlined" variant="success" class="checklist-all-ok">
         <wa-icon slot="start" name="check-double"></wa-icon>
         All OK, continue
       </wa-button>`
    : "";
  return `
    <h3 class="checklist-title">${escapeHtml(group.title)}</h3>
    <ul class="checklist-items">
      ${items.map((item) => itemRow(item, answers[item.id])).join("")}
    </ul>
    ${allOk}`;
}

function referencePage(state: AppState): string {
  const steps = visibleItems(IN_FLIGHT_STEPS, state.params.droneType);
  const emergencies = EMERGENCIES.map(
    ({ situation, action }) =>
      `<tr><th scope="row">${escapeHtml(situation)}</th><td>${escapeHtml(action)}</td></tr>`,
  );
  return `
    <div class="in-flight">
      <h3>Step by step</h3>
      <ol class="checklist-steps">
        ${steps.map((line) => `<li>${escapeHtml(line.text)}</li>`).join("")}
      </ol>
      <h3>In an emergency</h3>
      <table class="checklist-emergencies">
        <thead><tr><th scope="col">If</th><th scope="col">Do this</th></tr></thead>
        <tbody>${emergencies.join("")}</tbody>
      </table>
    </div>`;
}

// The reference closes the stages flown right after, not the one done at base.
function pageCount(stage: ChecklistStage): number {
  return stage.groups.length + (stage.key === "depart" ? 0 : 1);
}

/**
 * Opens one stage, or with no stage given, a list of all three. The list is
 * the header's entry point, so the pilot always chooses which one they see.
 * Resolves once the checklist is closed.
 */
export function openChecklist(ctx: StepContext, key?: StageKey, reference = false): Promise<void> {
  const { droneType } = ctx.state.params;
  const fromList = key === undefined;
  let stage: ChecklistStage | null = null;
  let page = 0;

  const dialog = document.querySelector<Dialog>("#checklist")!;
  const body = dialog.querySelector<HTMLElement>("#checklist-body")!;
  const back = dialog.querySelector<HTMLElement & { disabled: boolean }>("#checklist-back")!;
  const next = dialog.querySelector<HTMLElement>("#checklist-next")!;

  const lastPageLabel = (shown: ChecklistStage) => {
    if (fromList) return "All lists";
    const { answered, total } = stageProgress(shown, loadChecklist(), droneType);
    return answered < total ? "Close" : "Done";
  };

  const render = () => {
    body.scrollIntoView();
    if (!stage) {
      dialog.label = "Flight checklist";
      body.innerHTML = checklistOverview(ctx.state);
      mountChecklistCard(body, ctx, showStage);
      back.hidden = true;
      next.textContent = "Close";
      return;
    }
    const group = stage.groups[page];
    const last = pageCount(stage) - 1;
    const heading = group ? stage : IN_FLIGHT;
    dialog.label = heading.title;
    body.innerHTML = `
      <p class="muted">${escapeHtml(heading.hint)} Page ${page + 1} of ${last + 1}.</p>
      ${group ? groupPage(group, ctx.state) : referencePage(ctx.state)}`;
    back.hidden = false;
    back.disabled = page === 0 && !fromList;
    next.textContent = page === last ? lastPageLabel(stage) : "Next";
  };

  function showStage(nextKey: StageKey, onReference = false): void {
    stage = stageByKey(nextKey);
    page = onReference ? pageCount(stage) - 1 : 0;
    render();
  }

  const showList = () => {
    stage = null;
    render();
  };

  // Updates only the answered row, so focus stays on the radio just used.
  body.onchange = (event) => {
    const group = (event.target as HTMLElement).closest<HTMLElement & { value: string }>(
      "wa-radio-group[data-item]",
    );
    if (!group || !stage) return;
    const id = group.dataset.item!;
    const answer = group.value as Answer;
    const item = stageItems(stage, droneType).find((candidate) => candidate.id === id)!;
    saveChecklist(ctx, withAnswer(loadChecklist(), id, answer));
    body.querySelector(`[data-not-ok="${id}"]`)!.innerHTML = notOkMessage(item, answer);
    if (page === pageCount(stage) - 1) next.textContent = lastPageLabel(stage);
  };
  body.onclick = (event) => {
    if (!stage || !(event.target as HTMLElement).closest("[data-all-ok]")) return;
    const items = visibleItems(stage.groups[page].items, droneType);
    saveChecklist(ctx, withUnansweredOk(loadChecklist(), items));
    goNext();
  };
  back.onclick = () => {
    if (page === 0) return showList();
    page -= 1;
    render();
  };
  function goNext(): void {
    if (stage && page < pageCount(stage) - 1) {
      page += 1;
      return render();
    }
    if (stage && fromList) return showList();
    dialog.open = false;
  }
  next.onclick = goNext;

  const closed = new Promise<void>((resolve) => {
    const onHide = () => {
      refreshChecklistViews(ctx);
      resolve();
    };
    dialog.addEventListener("wa-after-hide", onHide, { once: true });
  });
  if (key) showStage(key, reference);
  else showList();
  dialog.open = true;
  return closed;
}
