import type { MapController } from "./map";
import type { AoiResult } from "./core/aoi";
import type { Bbox, DemSampler } from "./core/dem";
import type { PlanParams, PlanResult } from "./core/flightplan";
import { DEFAULT_PARAMS } from "./core/flightplan";
import { planLabel } from "./core/outputs";
import {
  newPlanId,
  deletePlan,
  demKeyFor,
  getDemBytes,
  planPath,
  putDem,
  readJson,
  updatePlanMeta,
  writeJson,
  getBackend,
  type DemEntry,
  type PlanMeta,
} from "./core/storage";

export interface AppState {
  step: number;
  meta: PlanMeta;
  aoi: AoiResult | null;
  params: PlanParams;
  dem: {
    sampler: DemSampler | null;
    bytes: ArrayBuffer | null;
    entry: DemEntry | null;
    fromStore: boolean;
    saved: boolean;
    skipped: boolean;
  };
  /** An uploaded DEM available for explicit reuse. */
  storedUpload: DemEntry | null;
  projectBbox: Bbox | null;
  result: PlanResult | null;
}

export interface StepContext {
  state: AppState;
  map: MapController;
  refresh(): void;
  goTo(step: number): void;
  toast(message: string, variant?: "brand" | "success" | "warning" | "danger"): void;
  /** Resolves true when the plan reached storage, false when it could not. */
  save(writeDem?: boolean): Promise<boolean>;
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

export const NO_TERRAIN: AppState["dem"] = {
  sampler: null,
  bytes: null,
  entry: null,
  fromStore: false,
  saved: false,
  skipped: false,
};

export function resetTerrain(state: AppState): void {
  state.dem = { ...NO_TERRAIN };
  state.storedUpload = null;
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
    dem: { ...NO_TERRAIN },
    storedUpload: null,
    projectBbox: null,
    result: null,
  };
}

export async function savePlan(state: AppState, writeDem: boolean): Promise<void> {
  const backend = getBackend();
  const { meta, aoi, params, dem } = state;

  // Preserve empty handoffs, but do not keep empty standalone plans.
  if (!aoi && !meta.projectId && !meta.taskId) {
    await deletePlan(meta.id);
    return;
  }

  meta.updatedAt = new Date().toISOString();

  if (aoi) {
    meta.areaM2 = aoi.areaM2;
    await writeJson(planPath.aoi(meta.id), {
      type: "FeatureCollection",
      features: [
        {
          type: "Feature",
          properties: { name: planLabel(meta) },
          geometry: { type: "Polygon", coordinates: [aoi.ring] },
        },
      ],
    });
  } else {
    delete meta.areaM2;
    delete meta.generatedAt;
    delete meta.dem;
    await backend.remove(planPath.aoi(meta.id));
    await backend.remove(planPath.dem(meta.id));
  }

  await writeJson(planPath.params(meta.id), params);

  // Plans reference DEMs in the shared store.
  if (writeDem && dem.bytes && dem.entry) {
    await putDem(dem.entry, dem.bytes);
    meta.dem = { ...dem.entry };
  }
  if (!meta.dem) await backend.remove(planPath.dem(meta.id));

  await writeJson(planPath.meta(meta.id), meta);
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
  const demBytes = meta.dem ? await loadPlanDem(id, meta) : null;

  return { meta, aoiRing, params, demBytes };
}

/** Reads shared terrain and migrates a legacy per-plan DEM when needed. */
async function loadPlanDem(id: string, meta: PlanMeta): Promise<ArrayBuffer | null> {
  const dem = meta.dem;
  if (!dem) return null;

  if (dem.key) {
    const bytes = await getDemBytes(dem.key);
    if (bytes) return bytes;
  }

  const legacy = await getBackend().get(planPath.dem(id));
  if (!legacy) return null;

  const key = dem.key ?? (await demKeyFor(dem, legacy));
  await putDem({ ...dem, key, byteLength: legacy.byteLength }, legacy);
  await updatePlanMeta(id, (stored) => {
    if (stored.dem) stored.dem.key = key;
  });
  await getBackend().remove(planPath.dem(id));
  dem.key = key;
  return legacy;
}
