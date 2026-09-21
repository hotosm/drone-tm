import { afterEach, describe, expect, it } from "vitest";
import {
  groupSegment,
  listPlans,
  migratePlanLayout,
  newPlanId,
  planGroup,
  planPath,
  putDem,
  readPlanRings,
  setBackend,
  terrainCoverage,
  UNGROUPED,
  type DemEntry,
  type PlanMeta,
} from "../src/core/storage";
import type { Bbox } from "../src/core/dem";
import { MemoryBackend, useMemory } from "./memory-backend";

Object.defineProperty(globalThis, "location", {
  value: new URL("https://drone.hotosm.org/plan/"),
  configurable: true,
});

afterEach(() => setBackend(null));

const PROJECT: Bbox = [85.2, 27.6, 85.6, 28.0];
const TASK: Bbox = [85.3, 27.7, 85.32, 27.72];
const ELSEWHERE: Bbox = [12.0, 41.0, 12.02, 41.02];

function meta(id: string, over: Partial<PlanMeta> = {}): PlanMeta {
  const now = new Date().toISOString();
  return { id, name: "", createdAt: now, updatedAt: now, ...over };
}

async function writePlan(backend: MemoryBackend, plan: PlanMeta): Promise<void> {
  await backend.put(planPath.meta(plan.id), JSON.stringify(plan));
  await backend.put(planPath.aoi(plan.id), "{}");
}

async function storeDem(bbox: Bbox, key = "glo30_project"): Promise<DemEntry> {
  const dem: DemEntry = {
    key,
    bbox,
    width: 16,
    height: 16,
    sourceUrl: "https://example.test/dem.tif",
    fetchedAt: new Date().toISOString(),
    byteLength: 1024,
    source: "GLO30",
  };
  await putDem(dem, new ArrayBuffer(dem.byteLength));
  return dem;
}

describe("plan ids", () => {
  it("puts a project's plans in a folder of their own", () => {
    const id = newPlanId("4f3c1a2b-0000-4000-8000-000000000000");
    expect(planGroup(id)).toBe("4f3c1a2b-0000-4000-8000-000000000000");
    expect(id.startsWith("4f3c1a2b-0000-4000-8000-000000000000/")).toBe(true);
  });

  it("keeps a hand-drawn plan out of any project", () => {
    expect(planGroup(newPlanId())).toBe(UNGROUPED);
    expect(planGroup("2026-09-21-abcd1234")).toBe(UNGROUPED);
  });

  it("refuses to let a project id escape its folder", () => {
    expect(groupSegment("../../dems")).toBe("-dems");
    expect(groupSegment("a/b")).toBe("a-b");
    expect(groupSegment("")).toBe(UNGROUPED);
  });

  it("keeps two projects' task 3 apart", () => {
    const first = newPlanId("project-one");
    const second = newPlanId("project-two");
    expect(planGroup(first)).not.toBe(planGroup(second));
  });
});

describe("migratePlanLayout", () => {
  it("moves a flat plan into its project folder, with everything under it", async () => {
    const backend = useMemory();
    await writePlan(backend, meta("2026-09-11-oldplan", { projectId: "p1", taskId: "3" }));
    await backend.put("plans/2026-09-11-oldplan/out/task_3.kmz", "kmz");

    expect(await migratePlanLayout()).toBe(1);

    const [plan] = await listPlans();
    expect(plan.id).toBe("p1/2026-09-11-oldplan");
    expect(await backend.get(`plans/${plan.id}/out/task_3.kmz`)).not.toBeNull();
    expect(await backend.get(planPath.meta("2026-09-11-oldplan"))).toBeNull();
  });

  it("files a plan that came from no project under the loose folder", async () => {
    const backend = useMemory();
    await writePlan(backend, meta("2026-09-11-loose"));

    await migratePlanLayout();

    expect((await listPlans())[0].id).toBe(`${UNGROUPED}/2026-09-11-loose`);
  });

  it("backfills the extent from the stored area, so the list can judge terrain", async () => {
    const backend = useMemory();
    await backend.put(
      planPath.meta("2026-09-11-oldplan"),
      JSON.stringify(meta("2026-09-11-oldplan")),
    );
    await backend.put(
      planPath.aoi("2026-09-11-oldplan"),
      JSON.stringify({
        type: "FeatureCollection",
        features: [
          {
            type: "Feature",
            geometry: {
              type: "Polygon",
              coordinates: [
                [
                  [85.3, 27.7],
                  [85.32, 27.7],
                  [85.32, 27.72],
                  [85.3, 27.7],
                ],
              ],
            },
          },
        ],
      }),
    );
    await backend.put(
      planPath.params("2026-09-11-oldplan"),
      JSON.stringify({ takeoffPoint: { lon: 85.28, lat: 27.69 } }),
    );

    await migratePlanLayout();

    // The takeoff point sits outside the area, so it has to widen the extent.
    expect((await listPlans())[0].bbox).toEqual([85.28, 27.69, 85.32, 27.72]);
  });

  it("runs again over migrated plans without moving anything", async () => {
    const backend = useMemory();
    await writePlan(backend, meta("2026-09-11-oldplan", { projectId: "p1" }));

    expect(await migratePlanLayout()).toBe(1);
    expect(await migratePlanLayout()).toBe(0);
    expect(await listPlans()).toHaveLength(1);
  });

  it("lists a flat plan even before it is moved", async () => {
    const backend = useMemory();
    await writePlan(backend, meta("2026-09-11-oldplan", { projectId: "p1" }));

    expect((await listPlans()).map((plan) => plan.id)).toEqual(["2026-09-11-oldplan"]);
  });
});

describe("readPlanRings", () => {
  const ring = [
    [85.3, 27.7],
    [85.32, 27.7],
    [85.32, 27.72],
    [85.3, 27.7],
  ];

  it("reads the outlines the map draws the project's tasks from", async () => {
    const backend = useMemory();
    const plan = meta("p1/one", { taskId: "1" });
    await backend.put(planPath.meta(plan.id), JSON.stringify(plan));
    await backend.put(
      planPath.aoi(plan.id),
      JSON.stringify({
        type: "FeatureCollection",
        features: [{ type: "Feature", geometry: { type: "Polygon", coordinates: [ring] } }],
      }),
    );

    const rings = await readPlanRings(await listPlans());
    expect(rings.get("p1/one")).toEqual(ring);
  });

  it("leaves out a plan with no area yet, rather than drawing nothing", async () => {
    const backend = useMemory();
    const plan = meta("p1/empty", { taskId: "2" });
    await backend.put(planPath.meta(plan.id), JSON.stringify(plan));

    const rings = await readPlanRings(await listPlans());
    expect(rings.size).toBe(0);
  });
});

describe("terrainCoverage", () => {
  it("counts a task whose project crop is downloaded, before it is opened", async () => {
    const backend = useMemory();
    await storeDem(PROJECT);
    const downloaded = meta("p1/one", { taskId: "1", bbox: TASK });
    const sibling = meta("p1/two", { taskId: "2", bbox: [85.35, 27.75, 85.37, 27.77] });
    await writePlan(backend, downloaded);
    await writePlan(backend, sibling);

    const ready = await terrainCoverage(await listPlans());

    expect(ready.has("p1/one")).toBe(true);
    expect(ready.has("p1/two")).toBe(true);
  });

  it("does not claim terrain for an area the crop misses", async () => {
    const backend = useMemory();
    await storeDem(PROJECT);
    await writePlan(backend, meta("p1/far", { bbox: ELSEWHERE }));

    expect((await terrainCoverage(await listPlans())).has("p1/far")).toBe(false);
  });

  it("still trusts terrain a plan holds directly, with nothing to compare", async () => {
    const backend = useMemory();
    const dem = await storeDem(PROJECT);
    await writePlan(backend, meta("p1/one", { dem: { ...dem } }));

    expect((await terrainCoverage(await listPlans())).has("p1/one")).toBe(true);
  });

  it("says nothing about a plan whose extent was never recorded", async () => {
    const backend = useMemory();
    await storeDem(PROJECT);
    await writePlan(backend, meta("p1/legacy"));

    expect((await terrainCoverage(await listPlans())).size).toBe(0);
  });
});
