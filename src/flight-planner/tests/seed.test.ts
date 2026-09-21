import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/core/flightplan";
import { parseTasks, seedTaskPlans, SeedError, tasksBbox, type SeededTask } from "../src/core/seed";
import {
  listPlans,
  planGroup,
  planPath,
  readJson,
  setBackend,
  updatePlanMeta,
} from "../src/core/storage";
import { useMemory } from "./memory-backend";

Object.defineProperty(globalThis, "location", {
  value: new URL("https://drone.hotosm.org/plan/"),
  configurable: true,
});

afterEach(() => setBackend(null));

const square = (lon: number, lat: number, size = 0.01) => [
  [lon, lat],
  [lon + size, lat],
  [lon + size, lat + size],
  [lon, lat + size],
  [lon, lat],
];

const feature = (taskIndex: number, lon: number, takeOff: number[] | null = null) => ({
  type: "Feature",
  geometry: { type: "Polygon", coordinates: [square(lon, 27.7)] },
  properties: {
    project_task_id: taskIndex,
    take_off_point: takeOff,
  },
});

const collection = (...features: unknown[]) => ({ type: "FeatureCollection", features });

const parse = (geojson: unknown) => parseTasks(geojson).tasks;

describe("parseTasks", () => {
  it("reads every task in the collection", () => {
    const { tasks } = parseTasks(collection(feature(1, 85.3), feature(2, 85.4)));
    expect(tasks.map((task) => task.taskId)).toEqual(["1", "2"]);
    expect(tasks[0].areaM2).toBeGreaterThan(0);
  });

  it("keeps each task's own takeoff point", () => {
    const [withPoint, withoutPoint] = parseTasks(
      collection(feature(1, 85.3, [85.305, 27.705]), feature(2, 85.4)),
    ).tasks;
    expect(withPoint.takeoffPoint).toEqual({ lon: 85.305, lat: 27.705 });
    expect(withoutPoint.takeoffPoint).toBeNull();
  });

  it("ignores a takeoff point that is not a usable coordinate", () => {
    const [task] = parseTasks(collection(feature(1, 85.3, [999, 27.7]))).tasks;
    expect(task.takeoffPoint).toBeNull();
  });

  it("skips a broken outline rather than losing the whole project", () => {
    const broken = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[85.3, 27.7]]] },
      properties: { project_task_id: 9 },
    };
    const { tasks, unreadable } = parseTasks(collection(broken, feature(2, 85.4)));
    expect(tasks.map((task) => task.taskId)).toEqual(["2"]);
    expect(unreadable).toBe(1);
  });

  it("counts features with no task id, so the pilot is told what was missed", () => {
    const untagged = { ...feature(9, 85.9), properties: {} };
    const { tasks, unreadable } = parseTasks(collection(untagged, feature(2, 85.4)));
    expect(tasks).toHaveLength(1);
    expect(unreadable).toBe(1);
  });

  it("rejects a collection with no tasks in it", () => {
    expect(() => parseTasks(collection())).toThrow(SeedError);
  });

  it("rejects a collection where nothing could be read", () => {
    const untagged = { ...feature(1, 85.3), properties: {} };
    expect(() => parseTasks(collection(untagged))).toThrow(SeedError);
  });
});

describe("tasksBbox", () => {
  it("spans every task", () => {
    const tasks = parse(collection(feature(1, 85.3), feature(2, 85.5)));
    const [minx, , maxx] = tasksBbox(tasks);
    expect(minx).toBeCloseTo(85.3, 6);
    expect(maxx).toBeCloseTo(85.51, 6);
  });
});

describe("seedTaskPlans", () => {
  const seed = (tasks: SeededTask[]) =>
    seedTaskPlans({ projectId: "p1", tasks, params: DEFAULT_PARAMS });

  it("writes one plan per task, labelled by task", async () => {
    useMemory();
    const tasks = parse(collection(feature(1, 85.3), feature(2, 85.4)));

    const result = await seed(tasks);
    expect(result.added).toBe(2);

    const plans = await listPlans();
    expect(plans).toHaveLength(2);
    expect(plans.map((plan) => plan.taskId).sort()).toEqual(["1", "2"]);
    expect(plans.every((plan) => plan.projectId === "p1")).toBe(true);
  });

  it("stores inputs only - never a generated flightplan", async () => {
    useMemory();
    await seed(parse(collection(feature(1, 85.3))));

    const [plan] = await listPlans();
    expect(await readJson(planPath.aoi(plan.id))).toBeTruthy();
    expect(await readJson(planPath.params(plan.id))).toBeTruthy();
    expect(plan.generatedAt).toBeUndefined();
  });

  it("gives each plan the project settings with its own takeoff point", async () => {
    useMemory();
    await seed(parse(collection(feature(1, 85.3, [85.305, 27.705]))));

    const [plan] = await listPlans();
    const params = await readJson<Record<string, unknown>>(planPath.params(plan.id));
    expect(params?.takeoffPoint).toEqual({ lon: 85.305, lat: 27.705 });
    expect(params?.forwardOverlap).toBe(DEFAULT_PARAMS.forwardOverlap);
  });

  it("tops up new tasks without duplicating the ones already saved", async () => {
    useMemory();
    await seed(parse(collection(feature(1, 85.3))));
    const [first] = await listPlans();

    const result = await seed(parse(collection(feature(1, 85.3), feature(2, 85.4))));
    expect(result.added).toBe(1);
    expect(result.updated).toBe(1);

    const plans = await listPlans();
    expect(plans).toHaveLength(2);
    expect(plans.some((plan) => plan.id === first.id)).toBe(true);
  });

  it("refreshes a task the pilot has not touched, so the project stays current", async () => {
    useMemory();
    await seed(parse(collection(feature(1, 85.3))));

    const moved = await seed(parse(collection(feature(1, 85.9, [85.905, 27.705]))));
    expect(moved.updated).toBe(1);
    expect(moved.kept).toBe(0);

    const [plan] = await listPlans();
    expect(plan.bbox?.[0]).toBeCloseTo(85.9, 6);
    const params = await readJson<Record<string, unknown>>(planPath.params(plan.id));
    expect(params?.takeoffPoint).toEqual({ lon: 85.905, lat: 27.705 });
  });

  it("leaves a task the pilot has worked on alone", async () => {
    useMemory();
    await seed(parse(collection(feature(1, 85.3))));
    const [saved] = await listPlans();
    await updatePlanMeta(saved.id, (meta) => {
      meta.updatedAt = new Date(Date.now() + 1000).toISOString();
      meta.name = "My edited task";
    });

    const again = await seed(parse(collection(feature(1, 85.9))));
    expect(again.kept).toBe(1);
    expect(again.updated).toBe(0);

    const [plan] = await listPlans();
    expect(plan.name).toBe("My edited task");
    expect(plan.bbox?.[0]).toBeCloseTo(85.3, 6);
  });

  it("still brings the project label up to date on a plan it leaves alone", async () => {
    useMemory();
    await seed(parse(collection(feature(1, 85.3))));
    const [saved] = await listPlans();
    await updatePlanMeta(saved.id, (meta) => {
      meta.updatedAt = new Date(Date.now() + 1000).toISOString();
    });

    await seedTaskPlans({
      projectId: "p1",
      projectName: "Renamed project",
      tasks: parse(collection(feature(1, 85.3))),
      params: DEFAULT_PARAMS,
    });

    expect((await listPlans())[0].projectName).toBe("Renamed project");
  });

  it("keeps projects apart", async () => {
    useMemory();
    const tasks = parse(collection(feature(1, 85.3)));
    await seedTaskPlans({ projectId: "p1", tasks, params: DEFAULT_PARAMS });
    const result = await seedTaskPlans({ projectId: "p2", tasks, params: DEFAULT_PARAMS });

    expect(result.added).toBe(1);
    expect(await listPlans()).toHaveLength(2);
  });

  it("files every task under its own project, so two task 1s stay apart", async () => {
    useMemory();
    const tasks = parse(collection(feature(1, 85.3), feature(2, 85.4)));
    await seedTaskPlans({ projectId: "p1", tasks, params: DEFAULT_PARAMS });
    await seedTaskPlans({ projectId: "p2", tasks, params: DEFAULT_PARAMS });

    const groups = (await listPlans()).map((plan) => planGroup(plan.id));
    expect(groups.filter((group) => group === "p1")).toHaveLength(2);
    expect(groups.filter((group) => group === "p2")).toHaveLength(2);
  });

  it("carries the project name, so the list is not a row of ids", async () => {
    useMemory();
    await seedTaskPlans({
      projectId: "p1",
      projectName: "Kathmandu ridge",
      tasks: parse(collection(feature(1, 85.3))),
      params: DEFAULT_PARAMS,
    });

    expect((await listPlans())[0].projectName).toBe("Kathmandu ridge");
  });

  it("records each task's extent, including its takeoff point", async () => {
    useMemory();
    await seedTaskPlans({
      projectId: "p1",
      tasks: parse(collection(feature(1, 85.3, [85.29, 27.69]))),
      params: DEFAULT_PARAMS,
    });

    expect((await listPlans())[0].bbox).toEqual([85.29, 27.69, 85.31, 27.71]);
  });

  it("reports progress, so a large project is not a frozen screen", async () => {
    useMemory();
    const seen: Array<[number, number]> = [];
    await seedTaskPlans({
      projectId: "p1",
      tasks: parse(collection(feature(1, 85.3), feature(2, 85.4))),
      params: DEFAULT_PARAMS,
      onProgress: (written, total) => seen.push([written, total]),
    });

    expect(seen[0]).toEqual([0, 2]);
    expect(seen.at(-1)).toEqual([2, 2]);
  });
});

describe("token handling", () => {
  it("only trusts the configured API origin", async () => {
    const { isTrustedApiUrl } = await import("../src/core/http");
    expect(isTrustedApiUrl("/api/projects/x/download-boundaries")).toBe(true);
    expect(isTrustedApiUrl("https://drone.hotosm.org/api/projects/x")).toBe(true);

    expect(isTrustedApiUrl("https://evil.example/steal")).toBe(false);
    expect(isTrustedApiUrl("//evil.example/steal")).toBe(false);
    expect(isTrustedApiUrl("https://drone.hotosm.org.evil.example/x")).toBe(false);
    expect(isTrustedApiUrl("https://drone.hotosm.org:8443/api/x")).toBe(false);
  });

  it("takes the API origin from the deployment's runtime config", async () => {
    const { isTrustedApiUrl } = await import("../src/core/http");
    const runtime = globalThis as { __RUNTIME_CONFIG__?: { VITE_API_URL?: string } };
    runtime.__RUNTIME_CONFIG__ = { VITE_API_URL: "https://api.drone.hotosm.org" };
    try {
      expect(isTrustedApiUrl("https://api.drone.hotosm.org/projects/x")).toBe(true);
      expect(isTrustedApiUrl("https://drone.hotosm.org/api/projects/x")).toBe(false);
    } finally {
      delete runtime.__RUNTIME_CONFIG__;
    }
  });
});
