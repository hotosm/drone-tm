import { afterEach, describe, expect, it } from "vitest";
import { DEFAULT_PARAMS } from "../src/core/flightplan";
import { parseTasks, seedTaskPlans, SeedError, tasksBbox } from "../src/core/seed";
import { listPlans, planPath, readJson, setBackend } from "../src/core/storage";
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

describe("parseTasks", () => {
  it("reads every task in the collection", () => {
    const tasks = parseTasks(collection(feature(1, 85.3), feature(2, 85.4)));
    expect(tasks.map((task) => task.taskId)).toEqual(["1", "2"]);
    expect(tasks[0].areaM2).toBeGreaterThan(0);
  });

  it("keeps each task's own takeoff point", () => {
    const [withPoint, withoutPoint] = parseTasks(
      collection(feature(1, 85.3, [85.305, 27.705]), feature(2, 85.4)),
    );
    expect(withPoint.takeoffPoint).toEqual({ lon: 85.305, lat: 27.705 });
    expect(withoutPoint.takeoffPoint).toBeNull();
  });

  it("ignores a takeoff point that is not a usable coordinate", () => {
    const [task] = parseTasks(collection(feature(1, 85.3, [999, 27.7])));
    expect(task.takeoffPoint).toBeNull();
  });

  it("skips a broken outline rather than losing the whole project", () => {
    const broken = {
      type: "Feature",
      geometry: { type: "Polygon", coordinates: [[[85.3, 27.7]]] },
      properties: { project_task_id: 9 },
    };
    const tasks = parseTasks(collection(broken, feature(2, 85.4)));
    expect(tasks.map((task) => task.taskId)).toEqual(["2"]);
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
    const tasks = parseTasks(collection(feature(1, 85.3), feature(2, 85.5)));
    const [minx, , maxx] = tasksBbox(tasks);
    expect(minx).toBeCloseTo(85.3, 6);
    expect(maxx).toBeCloseTo(85.51, 6);
  });
});

describe("seedTaskPlans", () => {
  const seed = (tasks: ReturnType<typeof parseTasks>) =>
    seedTaskPlans({ projectId: "p1", tasks, params: DEFAULT_PARAMS });

  it("writes one plan per task, labelled by task", async () => {
    useMemory();
    const tasks = parseTasks(collection(feature(1, 85.3), feature(2, 85.4)));

    const result = await seed(tasks);
    expect(result.added).toBe(2);

    const plans = await listPlans();
    expect(plans).toHaveLength(2);
    expect(plans.map((plan) => plan.taskId).sort()).toEqual(["1", "2"]);
    expect(plans.every((plan) => plan.projectId === "p1")).toBe(true);
  });

  it("stores inputs only - never a generated flightplan", async () => {
    useMemory();
    await seed(parseTasks(collection(feature(1, 85.3))));

    const [plan] = await listPlans();
    expect(await readJson(planPath.aoi(plan.id))).toBeTruthy();
    expect(await readJson(planPath.params(plan.id))).toBeTruthy();
    expect(plan.generatedAt).toBeUndefined();
  });

  it("gives each plan the project settings with its own takeoff point", async () => {
    useMemory();
    await seed(parseTasks(collection(feature(1, 85.3, [85.305, 27.705]))));

    const [plan] = await listPlans();
    const params = await readJson<Record<string, unknown>>(planPath.params(plan.id));
    expect(params?.takeoffPoint).toEqual({ lon: 85.305, lat: 27.705 });
    expect(params?.forwardOverlap).toBe(DEFAULT_PARAMS.forwardOverlap);
  });

  it("tops up new tasks without touching work already done offline", async () => {
    useMemory();
    await seed(parseTasks(collection(feature(1, 85.3))));
    const [first] = await listPlans();

    const result = await seed(parseTasks(collection(feature(1, 85.3), feature(2, 85.4))));
    expect(result.added).toBe(1);
    expect(result.skipped).toBe(1);

    const plans = await listPlans();
    expect(plans).toHaveLength(2);
    expect(plans.some((plan) => plan.id === first.id)).toBe(true);
  });

  it("keeps projects apart", async () => {
    useMemory();
    const tasks = parseTasks(collection(feature(1, 85.3)));
    await seedTaskPlans({ projectId: "p1", tasks, params: DEFAULT_PARAMS });
    const result = await seedTaskPlans({ projectId: "p2", tasks, params: DEFAULT_PARAMS });

    expect(result.added).toBe(1);
    expect(await listPlans()).toHaveLength(2);
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
