import {
  STAGES,
  type ChecklistItem,
  type ChecklistStage,
  type DroneSpecific,
  type StageKey,
} from "../checklist/content";
import { outputFormatFor } from "./qfield";
import type { DroneTypeKey } from "./types";

export type Answer = "ok" | "not_ok";
/** Worst first. "caution" means only image quality advice failed. */
export type ChecklistStatus = "stop" | "fix" | "todo" | "caution" | "ready";

/** One per browser, not per plan: a day's checks cover every task flown that day. */
export interface ChecklistState {
  /** Local day of these answers: yesterday's forecast check says nothing about today. */
  day: string;
  answers: Record<string, Answer>;
  /** Epoch ms of each stage's latest answer, to expire checks from an earlier site. */
  checkedAt: Partial<Record<StageKey, number>>;
}

// Long enough for repeat flights at one site, short enough to miss the next site.
const SITE_CHECKS_EXPIRE_MS = 3 * 60 * 60 * 1000;
const SITE_STAGES: StageKey[] = ["site", "next"];

function localDay(now = new Date()): string {
  return now.toLocaleDateString("en-CA");
}

function isStale(state: ChecklistState, key: StageKey, now: number): boolean {
  const checkedAt = state.checkedAt[key];
  return checkedAt !== undefined && now - checkedAt > SITE_CHECKS_EXPIRE_MS;
}

/**
 * Reads stored answers, starting afresh on a new day or when they cannot be
 * read. Site checks left untouched for hours are cleared, as they likely
 * describe an earlier site. Their time is kept, so the list can say why.
 */
export function readChecklist(
  raw: string | null,
  day = localDay(),
  now = Date.now(),
): ChecklistState {
  const fresh = { day, answers: {}, checkedAt: {} };
  if (!raw) return fresh;
  let stored: ChecklistState;
  try {
    stored = JSON.parse(raw) as ChecklistState;
  } catch {
    return fresh;
  }
  const readable = typeof stored.answers === "object" && typeof stored.checkedAt === "object";
  if (stored.day !== day || !readable) return fresh;
  return SITE_STAGES.filter((key) => isStale(stored, key, now)).reduce(
    (state, key) => ({ ...withoutStage(state, stageByKey(key)), checkedAt: state.checkedAt }),
    stored,
  );
}

function stageOfItem(id: string): ChecklistStage {
  return STAGES.find((stage) =>
    stage.groups.some((group) => group.items.some((item) => item.id === id)),
  )!;
}

export function withAnswer(
  state: ChecklistState,
  id: string,
  answer: Answer,
  now = Date.now(),
): ChecklistState {
  return {
    day: state.day,
    answers: { ...state.answers, [id]: answer },
    checkedAt: { ...state.checkedAt, [stageOfItem(id).key]: now },
  };
}

/** Marks only unanswered items OK, so a Not OK answer is never overwritten. */
export function withUnansweredOk(
  state: ChecklistState,
  items: ChecklistItem[],
  now = Date.now(),
): ChecklistState {
  return items
    .filter((item) => !state.answers[item.id])
    .reduce((next, item) => withAnswer(next, item.id, "ok", now), state);
}

/** Clears one stage, so a second flight is checked afresh rather than shown as done. */
export function withoutStage(state: ChecklistState, stage: ChecklistStage): ChecklistState {
  const answers = { ...state.answers };
  for (const item of stage.groups.flatMap((group) => group.items)) delete answers[item.id];
  const checkedAt = { ...state.checkedAt };
  delete checkedAt[stage.key];
  return { ...state, answers, checkedAt };
}

export function stageByKey(key: StageKey): ChecklistStage {
  return STAGES.find((stage) => stage.key === key)!;
}

export function visibleItems<T extends DroneSpecific>(items: T[], droneType: DroneTypeKey): T[] {
  const format = outputFormatFor(droneType);
  return items.filter((item) => !item.only || item.only === format);
}

export function stageItems(stage: ChecklistStage, droneType: DroneTypeKey): ChecklistItem[] {
  return visibleItems(
    stage.groups.flatMap((group) => group.items),
    droneType,
  );
}

export function failedItems(
  stage: ChecklistStage,
  state: ChecklistState,
  droneType: DroneTypeKey,
): ChecklistItem[] {
  return stageItems(stage, droneType).filter((item) => state.answers[item.id] === "not_ok");
}

export function unansweredItems(
  stage: ChecklistStage,
  state: ChecklistState,
  droneType: DroneTypeKey,
): ChecklistItem[] {
  return stageItems(stage, droneType).filter((item) => !state.answers[item.id]);
}

export function stageProgress(
  stage: ChecklistStage,
  state: ChecklistState,
  droneType: DroneTypeKey,
): { status: ChecklistStatus; answered: number; total: number } {
  const items = stageItems(stage, droneType);
  const failed = failedItems(stage, state, droneType);
  const answered = items.filter((item) => state.answers[item.id]).length;
  const total = items.length;

  if (failed.some((item) => item.severity === "stop")) return { status: "stop", answered, total };
  if (failed.some((item) => item.severity === "fix")) return { status: "fix", answered, total };
  if (answered < total) return { status: "todo", answered, total };
  return { status: failed.length > 0 ? "caution" : "ready", answered, total };
}

/** Every pre-departure item answered, with nothing worse than image quality advice failed. */
export function departComplete(state: ChecklistState, droneType: DroneTypeKey): boolean {
  const { status } = stageProgress(stageByKey("depart"), state, droneType);
  return status === "ready" || status === "caution";
}
