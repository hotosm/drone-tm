import { afterEach, describe, expect, it } from "vitest";
import { initialState, loadPlan, savePlan } from "../src/app";
import { PIXEL_DEG, type Bbox } from "../src/core/dem";
import {
  demPath,
  deleteStoredDem,
  demUsage,
  detachPlanDem,
  findCoveringDem,
  glo30DemKey,
  listDems,
  listPlans,
  uploadDemKey,
  migrateLegacyDems,
  planPath,
  pruneStaleDems,
  putDem,
  setBackend,
  type DemEntry,
  type PlanMeta,
} from "../src/core/storage";
import { MemoryBackend, useMemory } from "./memory-backend";

Object.defineProperty(globalThis, "location", {
  value: new URL("https://drone.hotosm.org/plan/"),
  configurable: true,
});

afterEach(() => setBackend(null));

const daysAgo = (days: number) => new Date(Date.now() - days * 86_400_000).toISOString();

const PROJECT: Bbox = [85.0, 27.5, 85.5, 28.0];
const TASK: Bbox = [85.24, 27.74, 85.25, 27.75];

function entry(over: Partial<DemEntry> = {}): DemEntry {
  const bbox = over.bbox ?? PROJECT;
  return {
    key: over.key ?? glo30DemKey(bbox),
    bbox,
    width: 1800,
    height: 1800,
    sourceUrl: "https://api.imagery.hotosm.org/raster/...",
    fetchedAt: daysAgo(0),
    byteLength: 64,
    source: "GLO30",
    ...over,
  };
}

async function store(over: Partial<DemEntry> = {}): Promise<DemEntry> {
  const dem = entry(over);
  await putDem(dem, new ArrayBuffer(dem.byteLength));
  return dem;
}

async function writePlan(
  backend: MemoryBackend,
  id: string,
  over: Partial<PlanMeta> = {},
): Promise<void> {
  await backend.put(
    planPath.meta(id),
    JSON.stringify({ id, name: "", createdAt: daysAgo(0), updatedAt: daysAgo(0), ...over }),
  );
  await backend.put(planPath.aoi(id), "{}");
}

describe("glo30DemKey", () => {
  it("names the same ground the same way, so it is downloaded once", () => {
    expect(glo30DemKey(PROJECT)).toBe(glo30DemKey([...PROJECT]));
    expect(glo30DemKey(PROJECT)).not.toBe(glo30DemKey([85.1, 27.5, 85.5, 28.0]));
  });

  it("is usable as a file name at negative coordinates", () => {
    expect(glo30DemKey([-74.1, -34.7, -74.0, -34.6])).toMatch(/^glo30_-?\d+_-?\d+_-?\d+_-?\d+$/);
  });
});

describe("uploadDemKey", () => {
  const bytes = (fill: number, length = 4096) => new Uint8Array(length).fill(fill).buffer;

  it("separates two files of the same name and size but different ground", async () => {
    const first = await uploadDemKey("dem.tif", bytes(1));
    const second = await uploadDemKey("dem.tif", bytes(2));

    expect(first).not.toBe(second);
  });

  it("gives the same file the same key, so five tasks share one copy", async () => {
    expect(await uploadDemKey("dem.tif", bytes(7))).toBe(await uploadDemKey("dem.tif", bytes(7)));
  });

  it("stays a usable file name whatever the upload was called", async () => {
    expect(await uploadDemKey("../my terrain (final)!.tif", bytes(3))).toMatch(/^upload_[\w-]+$/);
  });
});

describe("findCoveringDem", () => {
  it("finds the project download for a task inside it", async () => {
    useMemory();
    const project = await store();

    expect((await findCoveringDem(TASK))?.key).toBe(project.key);
  });

  it("prefers the smallest covering DEM, which is cheapest to open", async () => {
    useMemory();
    await store();
    const near = await store({
      bbox: [85.2, 27.7, 85.3, 27.8],
      width: 360,
      height: 360,
    });

    expect((await findCoveringDem(TASK))?.key).toBe(near.key);
  });

  it("refuses a DEM that only just reaches the area, given the turns outside it", async () => {
    useMemory();
    await store({ bbox: [...TASK] as Bbox });

    expect(await findCoveringDem(TASK)).toBeNull();
  });

  it("accepts one with room for the bilinear margin", async () => {
    useMemory();
    const pad = 4 * PIXEL_DEG;
    await store({
      bbox: [TASK[0] - pad, TASK[1] - pad, TASK[2] + pad, TASK[3] + pad],
    });

    expect(await findCoveringDem(TASK)).not.toBeNull();
  });

  it("ignores an entry whose raster was evicted from under it", async () => {
    const backend = useMemory();
    const dem = await store();
    backend.files.delete(demPath.tif(dem.key));

    expect(await findCoveringDem(TASK)).toBeNull();
  });

  it("never returns an uploaded DEM to an automatic lookup", async () => {
    useMemory();
    await store({
      key: "upload_mine_0123456789ab",
      source: "UPLOAD",
      width: 20,
      height: 20,
      sourceUrl: "upload:mine.tif",
    });

    expect(await findCoveringDem(TASK)).toBeNull();
    expect((await findCoveringDem(TASK, { source: "UPLOAD" }))?.source).toBe("UPLOAD");
  });

  it("still finds the service crop when an upload also covers the area", async () => {
    useMemory();
    const project = await store();
    await store({
      key: "upload_mine_0123456789ab",
      source: "UPLOAD",
      width: 20,
      height: 20,
      sourceUrl: "upload:mine.tif",
    });

    expect((await findCoveringDem(TASK))?.key).toBe(project.key);
  });

  it("has nothing to offer an area outside everything stored", async () => {
    useMemory();
    await store();

    expect(await findCoveringDem([10, 10, 10.01, 10.01])).toBeNull();
  });
});

describe("sharing one DEM between tasks", () => {
  it("keeps a single copy of the raster for every plan that uses it", async () => {
    const backend = useMemory();
    const dem = entry();
    const bytes = new ArrayBuffer(dem.byteLength);

    for (const taskId of ["1", "2", "3"]) {
      const state = initialState();
      state.meta.taskId = taskId;
      state.aoi = { ring: [], bbox: [...TASK], areaM2: 100 };
      state.dem = {
        sampler: null,
        bytes,
        entry: dem,
        fromStore: false,
        saved: true,
        skipped: false,
      };
      await savePlan(state, true);
    }

    const rasters = [...backend.files.keys()].filter((path) => path.endsWith(".tif"));
    expect(rasters).toEqual([demPath.tif(dem.key)]);
    expect((await listPlans()).every((plan) => plan.dem?.key === dem.key)).toBe(true);
    expect((await demUsage()).get(dem.key)).toHaveLength(3);
  });

  it("reads a plan's terrain back out of the shared store", async () => {
    const backend = useMemory();
    const dem = await store();
    await writePlan(backend, "p", { dem: { ...dem } });

    expect((await loadPlan("p"))?.demBytes?.byteLength).toBe(dem.byteLength);
  });
});

describe("freeing terrain", () => {
  it("keeps the file while another plan still points at it", async () => {
    const backend = useMemory();
    const dem = await store();
    await writePlan(backend, "a", { dem: { ...dem } });
    await writePlan(backend, "b", { dem: { ...dem } });

    await detachPlanDem("a");

    expect(await backend.get(demPath.tif(dem.key))).not.toBeNull();
    expect((await demUsage()).get(dem.key)).toEqual(["b"]);
  });

  it("removes the file once the last plan lets go of it", async () => {
    const backend = useMemory();
    const dem = await store();
    await writePlan(backend, "a", { dem: { ...dem } });

    await detachPlanDem("a");

    expect(await backend.get(demPath.tif(dem.key))).toBeNull();
    expect(await listDems()).toEqual([]);
  });

  it("deleting a DEM outright detaches it from every plan", async () => {
    const backend = useMemory();
    const dem = await store();
    await writePlan(backend, "a", { dem: { ...dem } });
    await writePlan(backend, "b", { dem: { ...dem } });

    await deleteStoredDem(dem.key);

    expect(await backend.get(demPath.meta(dem.key))).toBeNull();
    expect((await listPlans()).every((plan) => plan.dem === undefined)).toBe(true);
  });

  it("survives a plan being deleted, because the next task wants it", async () => {
    const backend = useMemory();
    const dem = await store();
    const state = initialState();
    state.aoi = { ring: [], bbox: [...TASK], areaM2: 100 };
    state.dem = {
      sampler: null,
      bytes: new ArrayBuffer(dem.byteLength),
      entry: dem,
      fromStore: false,
      saved: true,
      skipped: false,
    };
    await savePlan(state, true);

    // An edit to the area drops the plan's claim on the terrain.
    delete state.meta.dem;
    state.dem = {
      sampler: null,
      bytes: null,
      entry: null,
      fromStore: false,
      saved: false,
      skipped: false,
    };
    await savePlan(state, false);

    expect(await backend.get(demPath.tif(dem.key))).not.toBeNull();
    expect(await findCoveringDem(TASK)).not.toBeNull();
  });
});

describe("pruneStaleDems", () => {
  it("leaves a recent unused download alone - it is why we bought the area", async () => {
    useMemory();
    await store({ fetchedAt: daysAgo(3) });

    expect(await pruneStaleDems()).toBe(0);
    expect(await listDems()).toHaveLength(1);
  });

  it("clears one nothing has wanted for months", async () => {
    useMemory();
    await store({ fetchedAt: daysAgo(200) });

    expect(await pruneStaleDems()).toBe(1);
    expect(await listDems()).toEqual([]);
  });

  it("never touches one a plan is using, however old", async () => {
    const backend = useMemory();
    const dem = await store({ fetchedAt: daysAgo(500) });
    await writePlan(backend, "p", { dem: { ...dem } });

    expect(await pruneStaleDems()).toBe(0);
    expect(await backend.get(demPath.tif(dem.key))).not.toBeNull();
  });
});

describe("migrateLegacyDems", () => {
  it("moves a per-plan DEM into the shared store and links it", async () => {
    const backend = useMemory();
    const { key, ...legacy } = entry();
    await writePlan(backend, "p", { dem: legacy });
    await backend.put(planPath.dem("p"), new ArrayBuffer(legacy.byteLength));

    expect(await migrateLegacyDems()).toBe(1);

    const plan = (await listPlans())[0];
    expect(plan.dem?.key).toBe(key);
    expect(await backend.get(planPath.dem("p"))).toBeNull();
    expect(await backend.get(demPath.tif(key))).not.toBeNull();
  });

  it("lets a second task find the migrated DEM by coverage", async () => {
    const backend = useMemory();
    const { key: _key, ...legacy } = entry();
    await writePlan(backend, "p", { dem: legacy });
    await backend.put(planPath.dem("p"), new ArrayBuffer(legacy.byteLength));

    await migrateLegacyDems();

    expect(await findCoveringDem(TASK)).not.toBeNull();
  });

  it("forgets terrain whose file went missing rather than keeping a dead reference", async () => {
    const backend = useMemory();
    const { key: _key, ...legacy } = entry();
    await writePlan(backend, "p", { dem: legacy });

    expect(await migrateLegacyDems()).toBe(0);
    expect((await listPlans())[0].dem).toBeUndefined();
  });

  it("leaves an already-shared plan alone", async () => {
    const backend = useMemory();
    const dem = await store();
    await writePlan(backend, "p", { dem: { ...dem } });

    expect(await migrateLegacyDems()).toBe(0);
  });
});
