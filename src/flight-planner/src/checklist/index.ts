import type { AppState, StepContext } from "../app";
import {
  downloadNeedsConfirmation,
  failedItems,
  stageByKey,
  stageItems,
  stageProgress,
  unansweredItems,
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
  FLIGHT_REFERENCE,
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
  fix: "Needs fixing",
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

// Worst first, so the header shows the most urgent problem.
const PROBLEMS: Array<{ severity: "stop" | "fix"; variant: string; heading: string }> = [
  { severity: "stop", variant: "danger", heading: "Do not fly until these are OK:" },
  { severity: "fix", variant: "warning", heading: "Fix these before takeoff:" },
];

function allFailedItems(state: AppState): ChecklistItem[] {
  const checklist = loadChecklist();
  return STAGES.flatMap((stage) => failedItems(stage, checklist, state.params.droneType));
}

function problemCallouts(state: AppState): string {
  const failed = allFailedItems(state);
  return PROBLEMS.map(({ severity, variant, heading }) => {
    const items = failed.filter((item) => item.severity === severity);
    if (items.length === 0) return "";
    return `
      <wa-callout variant="${variant}" appearance="outlined">
        <wa-icon slot="icon" name="triangle-exclamation"></wa-icon>
        <strong>${heading}</strong>
        <ul>${items.map((item) => `<li>${escapeHtml(item.label)}</li>`).join("")}</ul>
      </wa-callout>`;
  }).join("");
}

/**
 * Marks the header button while any answer is Not OK, or the pre-departure
 * checks are unfinished and not bypassed, so it is seen from every step.
 */
export function renderChecklistStatus(state: AppState): void {
  const failed = allFailedItems(state);
  const worst = PROBLEMS.find(({ severity }) => failed.some((item) => item.severity === severity));
  const unfinished = downloadNeedsConfirmation(loadChecklist(), state.params.droneType);
  const status = worst?.severity ?? (unfinished ? "todo" : null);
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
function checkedAgo(checkedAt: number | undefined, answered: number): string {
  if (checkedAt === undefined) return "";
  if (answered === 0) return ", cleared as the last checks were hours ago";
  const minutes = Math.round((Date.now() - checkedAt) / MINUTE_MS);
  if (minutes < 1) return ", just now";
  if (minutes < 60) return `, ${minutes} min ago`;
  return `, ${Math.floor(minutes / 60)} h ago`;
}

function stageRow(
  stage: ChecklistStage,
  checklist: ChecklistState,
  droneType: DroneTypeKey,
): string {
  const { status, answered, total } = stageProgress(stage, checklist, droneType);
  const resetLabel = RESET_LABEL[stage.key];
  const age = resetLabel ? checkedAgo(checklist.checkedAt[stage.key], answered) : "";
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
        <wa-button data-checklist-open="${stage.key}" appearance="outlined" size="s">
          ${answered === 0 ? "Start" : "Open"}
        </wa-button>
      </div>
    </div>`;
}

function checklistOverview(state: AppState): string {
  const checklist = loadChecklist();
  const rows = STAGES.map((stage) => stageRow(stage, checklist, state.params.droneType)).join("");

  return `
    ${problemCallouts(state)}
    <div class="downloads">
      ${rows}
      <div class="download-row">
        <div class="download-meta">
          <strong>During the flight, and emergencies</strong>
          <span class="muted">Read this before takeoff</span>
        </div>
        <wa-button data-checklist-reference appearance="outlined" size="s">Open</wa-button>
      </div>
    </div>`;
}

// Only the pre-departure checks matter before download. The rest are done at the site.
function cardBody(state: AppState): string {
  const depart = stageRow(stageByKey("depart"), loadChecklist(), state.params.droneType);
  return `
    ${problemCallouts(state)}
    <div class="downloads">${depart}</div>
    <p class="muted">The site checklists are in the header, under the clipboard icon.</p>`;
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
  return FLIGHT_REFERENCE.map((section) => {
    const lines = visibleItems(section.lines, state.params.droneType);
    return `
      <h3 class="checklist-title">${escapeHtml(section.title)}</h3>
      <ul class="checklist-reference">
        ${lines.map((line) => `<li>${escapeHtml(line.text)}</li>`).join("")}
      </ul>`;
  }).join("");
}

// One link per page with gaps, so a skipped check is one tap away without a long list.
function unansweredNote(stage: ChecklistStage, droneType: DroneTypeKey): string {
  const { answers } = loadChecklist();
  const links = stage.groups.flatMap((group, page) => {
    const missing = visibleItems(group.items, droneType).filter((item) => !answers[item.id]);
    if (missing.length === 0) return [];
    return `
      <li>
        <a href="#" data-goto="${page}">${escapeHtml(group.title)}: ${missing.length}</a>
      </li>`;
  });
  if (links.length === 0) return "";
  return `
    <wa-callout variant="warning" appearance="outlined" size="s">
      <wa-icon slot="icon" name="circle-question"></wa-icon>
      <strong>Not checked yet:</strong>
      <ul>${links.join("")}</ul>
    </wa-callout>`;
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
    dialog.label = stage.title;
    const unanswered =
      page === last ? `<div data-unanswered>${unansweredNote(stage, droneType)}</div>` : "";
    body.innerHTML = `
      <p class="muted">${escapeHtml(stage.hint)} Page ${page + 1} of ${last + 1}.</p>
      ${group ? groupPage(group, ctx.state) : referencePage(ctx.state)}
      ${unanswered}`;
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
    if (page !== pageCount(stage) - 1) return;
    next.textContent = lastPageLabel(stage);
    body.querySelector("[data-unanswered]")!.innerHTML = unansweredNote(stage, droneType);
  };
  body.onclick = (event) => {
    const target = event.target as HTMLElement;
    if (target.closest("[data-all-ok]") && stage) {
      const items = visibleItems(stage.groups[page].items, droneType);
      saveChecklist(ctx, withUnansweredOk(loadChecklist(), items));
      return goNext();
    }
    const link = target.closest<HTMLElement>("[data-goto]");
    if (!link) return;
    event.preventDefault();
    page = Number(link.dataset.goto);
    render();
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

const STOPPED_MESSAGE =
  'Not downloaded. Finish the "Before you leave" checks, or download at your own risk.';

/**
 * Resolves true when the download may go ahead. It never refuses for good.
 * After a review, the download carries on only if the checks are now complete.
 */
export function confirmDownload(ctx: StepContext): Promise<boolean> {
  const checklist = loadChecklist();
  const { droneType } = ctx.state.params;
  if (!downloadNeedsConfirmation(checklist, droneType)) return Promise.resolve(true);

  const stage = stageByKey("depart");
  const failed = failedItems(stage, checklist, droneType).filter(
    (item) => item.severity !== "advise",
  );
  const instruction = failed.some((item) => item.severity === "stop")
    ? "Do not fly until they are OK."
    : "Fix them before takeoff.";
  const missing = unansweredItems(stage, checklist, droneType).length;
  const failedNote = failed.length
    ? `<p><strong>You marked these as not OK. ${instruction}</strong></p>
       <ul>${failed.map((item) => `<li>${escapeHtml(item.label)}</li>`).join("")}</ul>`
    : "";
  const missingNote = missing
    ? `<p>${missing} of the "${escapeHtml(stage.title)}" checks are not done yet.</p>`
    : "";
  const dialog = document.querySelector<Dialog>("#checklist-risk")!;
  dialog.querySelector("#checklist-risk-body")!.innerHTML = `
    ${failedNote}
    ${missingNote}
    <p>You can still download the flight plan, but you fly at your own risk.</p>`;

  return new Promise((resolve) => {
    let choice: string | undefined;
    dialog.onclick = (event) => {
      choice = (event.target as HTMLElement).closest<HTMLElement>("[data-risk]")?.dataset.risk;
      if (choice) dialog.open = false;
    };
    dialog.addEventListener(
      "wa-after-hide",
      async () => {
        if (choice === "accept") saveChecklist(ctx, { ...checklist, riskAccepted: true });
        if (choice !== "review") return resolve(choice === "accept");
        await openChecklist(ctx, stage.key);
        const complete = !downloadNeedsConfirmation(loadChecklist(), droneType);
        if (!complete) ctx.toast(STOPPED_MESSAGE, "warning");
        resolve(complete);
      },
      { once: true },
    );
    dialog.open = true;
  });
}
