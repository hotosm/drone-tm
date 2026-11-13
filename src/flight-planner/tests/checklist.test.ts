import { describe, expect, it } from "vitest";
import { IN_FLIGHT_STEPS, STAGES } from "../src/checklist/content";
import {
  departComplete,
  readChecklist,
  stageByKey,
  stageProgress,
  visibleItems,
  withAnswer,
  withoutStage,
  withUnansweredOk,
  type ChecklistState,
} from "../src/core/checklist";

const DJI = "DJI_MINI_4_PRO";
const POTENSIC = "POTENSIC_ATOM_2";
const depart = stageByKey("depart");
const departItems = depart.groups.flatMap((group) => group.items);
const HOUR_MS = 60 * 60 * 1000;

function allOk(): ChecklistState {
  const answers = Object.fromEntries(departItems.map((item) => [item.id, "ok" as const]));
  return { day: "2026-11-06", answers, checkedAt: {} };
}

describe("checklist content", () => {
  it("never reuses an item id, as answers are keyed on them", () => {
    const ids = STAGES.flatMap((stage) => stage.groups.flatMap((g) => g.items.map((i) => i.id)));
    expect(new Set(ids).size).toBe(ids.length);
  });

  it("checks zoom and JPEG on every drone", () => {
    const items = stageByKey("site").groups.flatMap((group) => group.items);
    const ids = visibleItems(items, POTENSIC).map((item) => item.id);
    expect(ids).toEqual(expect.arrayContaining(["zoom", "jpeg"]));
  });

  it("shows each drone only its own app settings", () => {
    const items = stageByKey("site").groups.flatMap((group) => group.items);
    const potensic = visibleItems(items, POTENSIC).map((item) => item.id);
    const dji = visibleItems(items, DJI).map((item) => item.id);
    expect(potensic).toEqual(expect.arrayContaining(["beginner-mode", "virtual-fence"]));
    expect(potensic).not.toContain("max-altitude");
    expect(dji).toContain("max-altitude");
    expect(dji).not.toContain("beginner-mode");
  });

  it("only tells DJI pilots to start the photos by hand", () => {
    const lines = IN_FLIGHT_STEPS;
    const potensic = visibleItems(lines, POTENSIC).map((line) => line.text);
    expect(potensic.join()).not.toMatch(/Timed Shot/);
    expect(
      visibleItems(lines, DJI)
        .map((line) => line.text)
        .join(),
    ).toMatch(/Timed Shot/);
  });

  it("checks the plan is on the controller at the site, after it can be downloaded", () => {
    const ids = (key: "depart" | "site") =>
      stageByKey(key).groups.flatMap((group) => group.items.map((item) => item.id));
    expect(ids("depart")).not.toContain("plan-loaded");
    expect(ids("site")).toContain("plan-loaded");
  });
});

describe("stageProgress", () => {
  it("is unfinished until every item has an answer", () => {
    expect(stageProgress(depart, { day: "d", answers: {}, checkedAt: {} }, DJI)).toMatchObject({
      status: "todo",
      answered: 0,
      total: visibleItems(departItems, DJI).length,
    });
  });

  it("is ready when everything is OK", () => {
    expect(stageProgress(depart, allOk(), DJI).status).toBe("ready");
  });

  it("stops on a failed safety item, however much else is OK", () => {
    const state = withAnswer(allOk(), "authorized", "not_ok");
    expect(stageProgress(depart, state, DJI).status).toBe("stop");
  });

  it("only cautions on an image quality item", () => {
    const state = withAnswer(allOk(), "forecast", "not_ok");
    expect(stageProgress(depart, state, DJI).status).toBe("caution");
  });

  it("does not count items hidden for this drone", () => {
    const site = stageByKey("site");
    expect(stageProgress(site, allOk(), POTENSIC).total).toBeLessThan(
      stageProgress(site, allOk(), DJI).total,
    );
  });
});

describe("withoutStage", () => {
  it("clears one stage and keeps the rest", () => {
    const state = withAnswer(withAnswer(allOk(), "next-battery", "ok"), "next-zoom", "not_ok");
    const cleared = withoutStage(state, stageByKey("next"));
    expect(cleared.answers["next-battery"]).toBeUndefined();
    expect(cleared.answers["next-zoom"]).toBeUndefined();
    expect(stageProgress(depart, cleared, DJI).status).toBe("ready");
  });

  it("forgets when the stage was checked", () => {
    const state = withAnswer(allOk(), "next-zoom", "ok", 1000);
    expect(withoutStage(state, stageByKey("next")).checkedAt.next).toBeUndefined();
  });
});

describe("withAnswer", () => {
  it("records when the answer's own stage was last checked", () => {
    const state = withAnswer(allOk(), "gps", "ok", 1000);
    expect(state.checkedAt).toEqual({ site: 1000 });
  });
});

describe("withUnansweredOk", () => {
  const drone = stageByKey("site").groups[1].items;

  it("marks every unanswered item OK", () => {
    const state = withUnansweredOk({ day: "d", answers: {}, checkedAt: {} }, drone, 1000);
    expect(drone.every((item) => state.answers[item.id] === "ok")).toBe(true);
    expect(state.checkedAt).toEqual({ site: 1000 });
  });

  it("keeps a Not OK answer", () => {
    const state = withAnswer(allOk(), "propellers", "not_ok");
    expect(withUnansweredOk(state, drone).answers.propellers).toBe("not_ok");
  });
});

describe("readChecklist", () => {
  it("keeps today's answers", () => {
    const state = allOk();
    expect(readChecklist(JSON.stringify(state), state.day)).toEqual(state);
  });

  it("starts empty on a new day", () => {
    const stored = JSON.stringify(allOk());
    expect(readChecklist(stored, "2026-11-07")).toEqual({
      day: "2026-11-07",
      answers: {},
      checkedAt: {},
    });
  });

  it("clears site checks after a long gap, keeping the day's checks", () => {
    const morning = Date.parse("2026-11-06T08:00:00");
    const state = withAnswer(withAnswer(allOk(), "gps", "ok", morning), "next-zoom", "ok", morning);
    const later = readChecklist(JSON.stringify(state), state.day, morning + 2 * HOUR_MS);
    expect(later.answers.gps).toBeUndefined();
    expect(later.answers["next-zoom"]).toBeUndefined();
    expect(later.checkedAt).toEqual({});
    expect(stageProgress(depart, later, DJI).status).toBe("ready");
  });

  it("keeps site checks while repeat flights continue at one site", () => {
    const start = Date.parse("2026-11-06T08:00:00");
    const firstFlight = withAnswer(allOk(), "gps", "ok", start);
    const thirdFlight = withAnswer(firstFlight, "next-zoom", "ok", start + 1.25 * HOUR_MS);
    const later = readChecklist(JSON.stringify(thirdFlight), thirdFlight.day, start + 2 * HOUR_MS);
    expect(later.answers.gps).toBe("ok");
    expect(later.answers["next-zoom"]).toBe("ok");
  });

  it("starts empty when nothing is stored", () => {
    expect(readChecklist(null, "2026-11-07").answers).toEqual({});
  });

  it("starts empty when the stored value is unreadable", () => {
    expect(readChecklist("{not json", "2026-11-07").answers).toEqual({});
    expect(readChecklist('{"day":"2026-11-07"}', "2026-11-07").answers).toEqual({});
  });
});

describe("departComplete", () => {
  it("accepts a completed checklist", () => {
    expect(departComplete(allOk(), DJI)).toBe(true);
  });

  it("accepts image quality warnings", () => {
    expect(departComplete(withAnswer(allOk(), "forecast", "not_ok"), DJI)).toBe(true);
  });

  it("rejects unfinished or failed checks", () => {
    expect(departComplete({ day: "d", answers: {}, checkedAt: {} }, DJI)).toBe(false);
    expect(departComplete(withAnswer(allOk(), "authorized", "not_ok"), DJI)).toBe(false);
  });
});
