import { afterEach, describe, expect, it } from "vitest";
import { planLabel } from "../src/core/outputs";
import { initialState, resetTerrain, savePlan } from "../src/app";
import {
  deletePlan,
  detachPlanDem,
  listPlans,
  planPath,
  pruneEmptyPlans,
  setBackend,
  updatePlanMeta,
  type PlanMeta,
} from "../src/core/storage";
import { MemoryBackend, useMemory } from "./memory-backend";

Object.defineProperty(globalThis, "location", {
  value: new URL("https://plan.drone.hotosm.org/"),
  configurable: true,
});

afterEach(() => setBackend(null));

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

async function writePlan(backend: MemoryBackend, meta: PlanMeta, withAoi: boolean): Promise<void> {
  await backend.put(planPath.meta(meta.id), JSON.stringify(meta));
  if (withAoi) await backend.put(planPath.aoi(meta.id), "{}");
}

function meta(id: string, over: Partial<PlanMeta> = {}): PlanMeta {
  return {
    id,
    name: "",
    createdAt: daysAgo(0),
    updatedAt: daysAgo(0),
    ...over,
  };
}

describe("planLabel", () => {
  it("prefers the name the pilot gave it", () => {
    expect(planLabel(meta("a", { name: "Kathmandu ridge", taskId: "7" }))).toBe("Kathmandu ridge");
  });

  it("falls back to the DroneTM task for a handoff", () => {
    expect(planLabel(meta("a", { taskId: "7" }))).toBe("Task 7");
  });

  it("describes an unnamed plan by when it was started and how big it is", () => {
    const label = planLabel(meta("a", { createdAt: "2026-09-11T08:00:00.000Z", areaM2: 123_000 }));
    expect(label).toContain("12.3 ha");
    expect(label).toContain("·");
  });

  it("still says something when there is no area yet", () => {
    const label = planLabel(meta("a", { createdAt: "2026-09-11T08:00:00.000Z" }));
    expect(label).not.toBe("");
    expect(label).not.toContain("·");
  });

  it("never returns an empty label for unparsable dates", () => {
    expect(planLabel(meta("a", { createdAt: "not a date" }))).toBe("Untitled plan");
  });
});

describe("savePlan", () => {
  it("writes nothing until there is an area", async () => {
    const backend = useMemory();
    const state = initialState();

    await savePlan(state, false);

    expect(backend.files.size).toBe(0);
    expect(await listPlans()).toEqual([]);
  });

  it("removes a standalone plan when its area is cleared", async () => {
    const backend = useMemory();
    const state = initialState();
    state.aoi = {
      ring: [
        [85, 27],
        [85.01, 27],
        [85.01, 27.01],
        [85, 27],
      ],
      bbox: [85, 27, 85.01, 27.01],
      areaM2: 100,
    };
    await savePlan(state, false);

    state.aoi = null;
    await savePlan(state, false);

    expect(backend.files.size).toBe(0);
    expect(await listPlans()).toEqual([]);
  });

  it("writes a handoff even before an area arrives, so it survives going offline", async () => {
    const backend = useMemory();
    const state = initialState();
    state.meta.taskId = "42";

    await savePlan(state, false);

    expect(backend.files.has(planPath.meta(state.meta.id))).toBe(true);
  });

  it("records the area, so the list can label a plan from one read", async () => {
    useMemory();
    const state = initialState();
    state.aoi = {
      ring: [
        [85, 27],
        [85.01, 27],
        [85.01, 27.01],
        [85, 27.01],
        [85, 27],
      ],
      bbox: [85, 27, 85.01, 27.01],
      areaM2: 123_000,
    };

    await savePlan(state, false);

    expect((await listPlans())[0].areaM2).toBe(123_000);
  });

  it("finishes saving the plan that started the write", async () => {
    const backend = useMemory();
    const put = backend.put.bind(backend);
    let release!: () => void;
    let started!: () => void;
    const gate = new Promise<void>((resolve) => (release = resolve));
    const firstWrite = new Promise<void>((resolve) => (started = resolve));
    let delay = true;
    backend.put = async (path, data) => {
      if (delay) {
        delay = false;
        started();
        await gate;
      }
      await put(path, data);
    };

    const state = initialState();
    const savedId = state.meta.id;
    state.aoi = {
      ring: [
        [85, 27],
        [85.01, 27],
        [85.01, 27.01],
        [85, 27],
      ],
      bbox: [85, 27, 85.01, 27.01],
      areaM2: 100,
    };

    const saving = savePlan(state, false);
    await firstWrite;
    state.meta = meta("another-plan");
    state.aoi = null;
    release();
    await saving;

    expect((await listPlans()).map((plan) => plan.id)).toEqual([savedId]);
  });

  it("removes terrain invalidated by an area or takeoff change", async () => {
    const backend = useMemory();
    const state = initialState();
    state.aoi = {
      ring: [
        [85, 27],
        [85.01, 27],
        [85.01, 27.01],
        [85, 27],
      ],
      bbox: [85, 27, 85.01, 27.01],
      areaM2: 100,
    };
    state.meta.dem = {
      bbox: state.aoi.bbox,
      width: 10,
      height: 10,
      sourceUrl: "x",
      fetchedAt: daysAgo(0),
      byteLength: 400,
      source: "GLO30",
    };
    state.storedUpload = {
      ...state.meta.dem,
      key: "upload-old-area",
      source: "UPLOAD",
    };
    await backend.put(planPath.dem(state.meta.id), new ArrayBuffer(400));

    resetTerrain(state);
    await savePlan(state, false);

    expect(await backend.get(planPath.dem(state.meta.id))).toBeNull();
    expect((await listPlans())[0].dem).toBeUndefined();
    expect(state.storedUpload).toBeNull();
  });
});

describe("pruneEmptyPlans", () => {
  it("removes stale plans that never captured an area", async () => {
    const backend = useMemory();
    await writePlan(backend, meta("empty", { updatedAt: daysAgo(30) }), false);

    expect(await pruneEmptyPlans()).toBe(1);
    expect(await listPlans()).toEqual([]);
  });

  it("keeps a stale plan that has an area, even with no areaM2 in its meta", async () => {
    const backend = useMemory();
    await writePlan(backend, meta("legacy", { updatedAt: daysAgo(30) }), true);

    expect(await pruneEmptyPlans()).toBe(0);
    expect((await listPlans()).map((p) => p.id)).toEqual(["legacy"]);
  });

  it("leaves a recent empty plan alone - it is the one being worked on", async () => {
    const backend = useMemory();
    await writePlan(backend, meta("fresh", { updatedAt: daysAgo(1) }), false);

    expect(await pruneEmptyPlans()).toBe(0);
    expect((await listPlans()).map((p) => p.id)).toEqual(["fresh"]);
  });
});

describe("removing things", () => {
  it("frees the terrain without touching the rest of the plan", async () => {
    const backend = useMemory();
    await writePlan(
      backend,
      meta("p", {
        dem: {
          bbox: [85, 27, 85.01, 27.01],
          width: 10,
          height: 10,
          sourceUrl: "x",
          fetchedAt: daysAgo(0),
          byteLength: 400,
          source: "GLO30",
        },
      }),
      true,
    );
    await backend.put(planPath.dem("p"), new ArrayBuffer(400));

    await detachPlanDem("p");

    expect(await backend.get(planPath.dem("p"))).toBeNull();
    expect(await backend.get(planPath.aoi("p"))).not.toBeNull();
    expect((await listPlans())[0].dem).toBeUndefined();
  });

  it("deletes a plan and everything beneath it", async () => {
    const backend = useMemory();
    await writePlan(backend, meta("p"), true);
    await backend.put(planPath.output("p", "plan.kmz"), "x");

    await deletePlan("p");

    expect(backend.files.size).toBe(0);
  });
});

describe("updatePlanMeta", () => {
  it("renames without re-sorting the list under the pilot's finger", async () => {
    const backend = useMemory();
    const updatedAt = daysAgo(3);
    await writePlan(backend, meta("p", { updatedAt }), true);

    const next = await updatePlanMeta("p", (m) => {
      m.name = "Bhaktapur school";
    });

    expect(next?.name).toBe("Bhaktapur school");
    expect((await listPlans())[0].updatedAt).toBe(updatedAt);
  });

  it("reports a missing plan rather than creating one", async () => {
    useMemory();
    expect(await updatePlanMeta("gone", (m) => (m.name = "x"))).toBeNull();
  });
});
