import type { MapController } from "./map";
import type { AoiResult } from "./core/aoi";
import type { DemSampler, SnappedBbox } from "./core/dem";
import type { PlanParams, PlanResult } from "./core/flightplan";
import { DEFAULT_PARAMS } from "./core/flightplan";
import { planLabel } from "./core/outputs";
import {
  newPlanId,
  deletePlan,
  planPath,
  readJson,
  writeJson,
  getBackend,
  type PlanMeta,
} from "./core/storage";

export interface AppState {
  step: number;
  meta: PlanMeta;
  aoi: AoiResult | null;
  params: PlanParams;
  dem: {
    sampler: DemSampler | null;
    snapped: SnappedBbox | null;
    bytes: ArrayBuffer | null;
    source: "GLO30" | "UPLOAD" | null;
    skipped: boolean;
  };
  result: PlanResult | null;
}

export interface StepContext {
  state: AppState;
  map: MapController;
  refresh(): void;
  goTo(step: number): void;
  toast(message: string, variant?: "brand" | "success" | "warning" | "danger"): void;
  save(writeDem?: boolean): Promise<void>;
  sheet: { collapseForMap(): void; restore(): void };
}

export interface Step {
  key: string;
  label: string;
  render(ctx: StepContext): string;
  mount(root: HTMLElement, ctx: StepContext): void | (() => void);
  blocker(state: AppState): string | null;
}

export const TOTAL_STEPS = 4;

export function resetTerrain(state: AppState): void {
  state.dem = { sampler: null, snapped: null, bytes: null, source: null, skipped: false };
  delete state.meta.dem;
  state.result = null;
}

export function initialState(): AppState {
  const now = new Date().toISOString();
  const search = new URLSearchParams(location.search);
  return {
    step: 1,
    meta: {
      id: newPlanId(),
      name: "",
      createdAt: now,
      updatedAt: now,
      ...(search.get("project") ? { projectId: search.get("project")! } : {}),
      ...(search.get("task") ? { taskId: search.get("task")! } : {}),
    },
    aoi: null,
    params: { ...DEFAULT_PARAMS },
    dem: { sampler: null, snapped: null, bytes: null, source: null, skipped: false },
    result: null,
  };
}

export async function savePlan(state: AppState, writeDem: boolean): Promise<void> {
  const backend = getBackend();

  // Preserve empty handoffs, but do not keep empty standalone plans.
  if (!state.aoi && !state.meta.projectId && !state.meta.taskId) {
    await deletePlan(state.meta.id);
    return;
  }

  state.meta.updatedAt = new Date().toISOString();

  if (state.aoi) {
    state.meta.areaM2 = state.aoi.areaM2;
    await writeJson(planPath.aoi(state.meta.id), {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: planLabel(state.meta) },
          geometry: { type: "Polygon", coordinates: [state.aoi.ring] },
        },
      ],
    });
  } else {
    delete state.meta.areaM2;
    delete state.meta.generatedAt;
    delete state.meta.dem;
    await backend.remove(planPath.aoi(state.meta.id));
    await backend.remove(planPath.dem(state.meta.id));
  }

  await writeJson(planPath.params(state.meta.id), state.params);

  if (writeDem && state.dem.bytes) {
    await backend.put(planPath.dem(state.meta.id), state.dem.bytes);
  } else if (!state.meta.dem) {
    await backend.remove(planPath.dem(state.meta.id));
  }

  await writeJson(planPath.meta(state.meta.id), state.meta);
}

export async function loadPlan(id: string): Promise<{
  meta: PlanMeta;
  aoiRing: Array<[number, number]> | null;
  params: unknown;
  demBytes: ArrayBuffer | null;
} | null> {
  const meta = await readJson<PlanMeta>(planPath.meta(id));
  if (!meta) return null;

  const aoiDoc = await readJson<{
    features?: Array<{ geometry?: { coordinates?: Array<Array<[number, number]>> } }>;
  }>(planPath.aoi(id));
  const aoiRing = aoiDoc?.features?.[0]?.geometry?.coordinates?.[0] ?? null;

  const params = await readJson<unknown>(planPath.params(id));
  const demBytes = meta.dem ? await getBackend().get(planPath.dem(id)) : null;

  return { meta, aoiRing, params, demBytes };
}
