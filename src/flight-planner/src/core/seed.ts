import { validateRing } from "./aoi";
import { bboxIncludingPoint, type Bbox } from "./dem";
import { dtmFetch } from "./http";
import type { PlanParams } from "./flightplan";
import { newPlanId, planPath, writeJson, listPlans, type PlanMeta } from "./storage";

export class SeedError extends Error {
  readonly guidance: string;
  constructor(message: string, guidance: string) {
    super(message);
    this.name = "SeedError";
    this.guidance = guidance;
  }
}

export interface SeededTask {
  taskId: string;
  ring: Array<[number, number]>;
  bbox: Bbox;
  areaM2: number;
  takeoffPoint: PlanParams["takeoffPoint"];
}

export interface SeedResult {
  added: number;
  updated: number;
  kept: number;
  tasks: SeededTask[];
}

export interface TaskParseResult {
  tasks: SeededTask[];
  unreadable: number;
}

function takeoffFrom(properties: Record<string, unknown> | undefined): PlanParams["takeoffPoint"] {
  const raw = properties?.take_off_point;
  if (!Array.isArray(raw) || raw.length < 2) return null;
  const lon = Number(raw[0]);
  const lat = Number(raw[1]);
  if (!Number.isFinite(lon) || !Number.isFinite(lat)) return null;
  if (Math.abs(lon) > 180 || Math.abs(lat) > 90) return null;
  return { lon, lat };
}

export function parseTasks(geojson: unknown): TaskParseResult {
  const root = geojson as Record<string, unknown> | null;
  const features = root?.type === "FeatureCollection" ? root.features : null;
  if (!Array.isArray(features) || features.length === 0) {
    throw new SeedError(
      "That link did not contain any task areas.",
      "Open a single task instead, or draw the area by hand.",
    );
  }

  const tasks: SeededTask[] = [];
  let unreadable = 0;
  for (const raw of features) {
    const feature = raw as Record<string, unknown>;
    const geometry = feature.geometry as Record<string, unknown> | undefined;
    if (geometry?.type !== "Polygon" || !Array.isArray(geometry.coordinates)) {
      unreadable += 1;
      continue;
    }

    const properties = feature.properties as Record<string, unknown> | undefined;
    const taskId = properties?.project_task_id;
    if (taskId === undefined || taskId === null) {
      unreadable += 1;
      continue;
    }

    try {
      const aoi = validateRing(geometry.coordinates[0] as Array<[number, number]>);
      tasks.push({
        taskId: String(taskId),
        ring: aoi.ring,
        bbox: aoi.bbox,
        areaM2: aoi.areaM2,
        takeoffPoint: takeoffFrom(properties),
      });
    } catch {
      unreadable += 1;
    }
  }

  if (tasks.length === 0) {
    throw new SeedError(
      "None of those task areas could be read.",
      "Open a single task instead, or draw the area by hand.",
    );
  }
  return { tasks, unreadable };
}

export async function fetchTasks(url: string): Promise<TaskParseResult> {
  const response = await dtmFetch(url);
  if (!response.ok) {
    throw new SeedError(
      `Could not load the task areas (${response.status}).`,
      response.status === 401 || response.status === 403
        ? "Sign in to DroneTM, then open this link again."
        : "The link may have expired. Open a single task instead.",
    );
  }
  return parseTasks(await response.json());
}

export function tasksBbox(tasks: SeededTask[]): Bbox {
  return tasks
    .map((task) => task.bbox)
    .reduce((acc, box) => [
      Math.min(acc[0], box[0]),
      Math.min(acc[1], box[1]),
      Math.max(acc[2], box[2]),
      Math.max(acc[3], box[3]),
    ]);
}

export async function seedTaskPlans(options: {
  projectId: string;
  projectName?: string | null;
  tasks: SeededTask[];
  params: PlanParams;
  projectBbox?: Bbox | null;
  onProgress?: (written: number, total: number) => void;
}): Promise<SeedResult> {
  const { projectId, projectName = null, tasks, params, projectBbox = null, onProgress } = options;

  const held = new Map(
    (await listPlans())
      .filter((plan) => plan.projectId === projectId && plan.taskId)
      .map((plan) => [plan.taskId as string, plan]),
  );

  const now = new Date().toISOString();
  let added = 0;
  let updated = 0;
  let kept = 0;

  let seen = 0;
  for (const task of tasks) {
    onProgress?.(seen++, tasks.length);
    const existing = held.get(task.taskId);

    // Preserve plans changed since the last seed.
    if (existing && existing.seededAt !== existing.updatedAt) {
      kept += 1;
      const changed =
        existing.projectName !== projectName ||
        JSON.stringify(existing.projectBbox) !== JSON.stringify(projectBbox ?? undefined);
      if (changed) {
        await writeJson(planPath.meta(existing.id), {
          ...existing,
          ...(projectName ? { projectName } : {}),
          ...(projectBbox ? { projectBbox } : {}),
        });
      }
      continue;
    }

    const id = existing?.id ?? newPlanId(projectId);
    const meta: PlanMeta = {
      id,
      name: existing?.name ?? "",
      createdAt: existing?.createdAt ?? now,
      updatedAt: now,
      seededAt: now,
      areaM2: task.areaM2,
      bbox: bboxIncludingPoint(task.bbox, task.takeoffPoint),
      projectId,
      ...(projectName ? { projectName } : {}),
      taskId: task.taskId,
      ...(projectBbox ? { projectBbox } : {}),
    };

    await writeJson(planPath.aoi(id), {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: `Task ${task.taskId}` },
          geometry: { type: "Polygon", coordinates: [task.ring] },
        },
      ],
    });
    await writeJson(planPath.params(id), { ...params, takeoffPoint: task.takeoffPoint });
    await writeJson(planPath.meta(id), meta);
    if (existing) updated += 1;
    else added += 1;
  }
  onProgress?.(tasks.length, tasks.length);

  return { added, updated, kept, tasks };
}
