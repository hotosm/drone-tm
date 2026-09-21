import { COACH, VIDEO_GUIDES, type CoachCard } from "./content";

const STORAGE_KEY = "dtm.tutorial.enabled";

let enabled = readInitialState();

function readInitialState(): boolean {
  const param = new URLSearchParams(location.search).get("tutorial");
  if (param === "0" || param === "false" || param === "off") return false;
  if (param === "1" || param === "true" || param === "on") return true;
  try {
    return localStorage.getItem(STORAGE_KEY) !== "0";
  } catch {
    return true;
  }
}

export function tutorialEnabled(): boolean {
  return enabled;
}

export function setTutorialEnabled(next: boolean): void {
  enabled = next;
  try {
    localStorage.setItem(STORAGE_KEY, next ? "1" : "0");
  } catch {
    /* preference is session-only */
  }
  document.documentElement.dataset.tutorial = next ? "on" : "off";
  window.dispatchEvent(new CustomEvent("tutorial-change", { detail: { enabled: next } }));
}

export function welcomeSeen(): boolean {
  try {
    return localStorage.getItem("dtm.welcome.seen") === "1";
  } catch {
    return false;
  }
}

export function markWelcomeSeen(): void {
  try {
    localStorage.setItem("dtm.welcome.seen", "1");
  } catch {
    /* ignore */
  }
}

function escapeHtml(value: string): string {
  return value.replace(
    /[&<>"']/g,
    (c) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[c]!,
  );
}

export function coachLead(stepKey: keyof typeof COACH | string): string {
  if (!enabled) return "";
  const card: CoachCard | undefined = COACH[stepKey];
  if (!card) return "";

  return `
    <wa-callout class="coach coach-lead-card" variant="brand" appearance="outlined">
      <wa-icon slot="icon" name="graduation-cap"></wa-icon>
      <strong class="coach-title">${escapeHtml(card.title)}</strong>
      <p class="coach-lead">${escapeHtml(card.lead)}</p>
    </wa-callout>`;
}

export function coachTips(stepKey: keyof typeof COACH | string): string {
  if (!enabled) return "";
  const card: CoachCard | undefined = COACH[stepKey];
  if (!card) return "";

  const points = card.points.map((point) => `<li>${escapeHtml(point)}</li>`).join("");

  const why = card.why
    ? `<wa-details class="coach-why" summary="Why this matters" appearance="plain">
         <p>${escapeHtml(card.why)}</p>
       </wa-details>`
    : "";

  const videos =
    VIDEO_GUIDES.length > 0
      ? `<p class="coach-video">Prefer to watch?
           ${VIDEO_GUIDES.map(
             (v) => `<a href="${v.url}" target="_blank" rel="noopener">${escapeHtml(v.label)}</a>`,
           ).join(", ")}
         </p>`
      : "";

  return `
    <div class="coach-tips">
      <ul class="coach-points">${points}</ul>
      ${why}
      ${videos}
    </div>`;
}

export function initTutorialAttribute(): void {
  document.documentElement.dataset.tutorial = enabled ? "on" : "off";
}
