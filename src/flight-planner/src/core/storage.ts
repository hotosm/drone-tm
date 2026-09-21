// OPFS storage with an IndexedDB fallback.

import {
  COVERAGE_MARGIN_PX,
  GRID_ORIGIN,
  PIXEL_DEG,
  bboxContains,
  bboxIncludingPoint,
  ringBbox,
  type Bbox,
} from "./dem";

export interface StorageBackend {
  readonly kind: "opfs" | "indexeddb";
  put(path: string, data: ArrayBuffer | string): Promise<void>;
  get(path: string): Promise<ArrayBuffer | null>;
  remove(path: string): Promise<void>;
  list(prefix: string): Promise<string[]>;
}

const DB_NAME = "dronetm-flight-planner";
const DB_STORE = "files";

function encode(data: ArrayBuffer | string): ArrayBuffer {
  if (typeof data === "string") return new TextEncoder().encode(data).buffer as ArrayBuffer;
  return data;
}

class OpfsBackend implements StorageBackend {
  readonly kind = "opfs" as const;

  private async dir(
    segments: string[],
    create: boolean,
  ): Promise<FileSystemDirectoryHandle | null> {
    let handle = await navigator.storage.getDirectory();
    for (const segment of segments) {
      try {
        handle = await handle.getDirectoryHandle(segment, { create });
      } catch {
        return null;
      }
    }
    return handle;
  }

  async put(path: string, data: ArrayBuffer | string): Promise<void> {
    const segments = path.split("/");
    const name = segments.pop()!;
    const dir = await this.dir(segments, true);
    if (!dir) throw new Error(`Could not create ${path}`);
    const file = await dir.getFileHandle(name, { create: true });
    const writable = await file.createWritable();
    await writable.write(encode(data));
    await writable.close();
  }

  async get(path: string): Promise<ArrayBuffer | null> {
    const segments = path.split("/");
    const name = segments.pop()!;
    const dir = await this.dir(segments, false);
    if (!dir) return null;
    try {
      const handle = await dir.getFileHandle(name);
      return await (await handle.getFile()).arrayBuffer();
    } catch {
      return null;
    }
  }

  async remove(path: string): Promise<void> {
    const segments = path.split("/");
    const name = segments.pop()!;
    const dir = await this.dir(segments, false);
    if (!dir) return;
    try {
      await dir.removeEntry(name, { recursive: true });
    } catch {
      /* already gone */
    }
  }

  async list(prefix: string): Promise<string[]> {
    const segments = prefix.split("/").filter(Boolean);
    const dir = await this.dir(segments, false);
    if (!dir) return [];
    const out: string[] = [];
    // @ts-expect-error - async iteration over directory handles is not in lib.dom yet
    for await (const [name] of dir.entries()) out.push(name);
    return out.sort();
  }
}

class IdbBackend implements StorageBackend {
  readonly kind = "indexeddb" as const;
  private db: Promise<IDBDatabase> | null = null;

  private open(): Promise<IDBDatabase> {
    this.db ??= new Promise((resolve, reject) => {
      const request = indexedDB.open(DB_NAME, 1);
      request.onupgradeneeded = () => request.result.createObjectStore(DB_STORE);
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    return this.db;
  }

  private async tx<T>(
    mode: IDBTransactionMode,
    run: (store: IDBObjectStore) => IDBRequest<T>,
  ): Promise<T> {
    const db = await this.open();
    return new Promise((resolve, reject) => {
      const request = run(db.transaction(DB_STORE, mode).objectStore(DB_STORE));
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
  }

  async put(path: string, data: ArrayBuffer | string): Promise<void> {
    await this.tx("readwrite", (s) => s.put(encode(data), path));
  }

  async get(path: string): Promise<ArrayBuffer | null> {
    const value = await this.tx<ArrayBuffer | undefined>("readonly", (s) => s.get(path));
    return value ?? null;
  }

  async remove(path: string): Promise<void> {
    const keys = await this.tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
    const doomed = keys
      .map(String)
      .filter((k) => k === path || k.startsWith(path.endsWith("/") ? path : `${path}/`));
    for (const key of doomed) {
      await this.tx("readwrite", (s) => s.delete(key));
    }
  }

  async list(prefix: string): Promise<string[]> {
    const keys = await this.tx<IDBValidKey[]>("readonly", (s) => s.getAllKeys());
    const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const names = new Set<string>();
    for (const key of keys.map(String)) {
      if (!key.startsWith(base)) continue;
      const rest = key.slice(base.length);
      if (rest) names.add(rest.split("/")[0]);
    }
    return [...names].sort();
  }
}

/**
 * Picks the store to use.
 *
 * Feature detection is not enough. A Firefox private window exposes
 * getDirectory() and then rejects it with a SecurityError, and Chrome does the
 * same where an origin's site data is blocked. IndexedDB still works in both,
 * so open OPFS once and see, rather than leaving every read and write to fail.
 */
export async function chooseBackend(): Promise<StorageBackend> {
  if (typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function") {
    try {
      await navigator.storage.getDirectory();
      return new OpfsBackend();
    } catch {
      /* Blocked or partitioned: IndexedDB is usually still allowed. */
    }
  }
  return new IdbBackend();
}

/** Defers the choice to the first read or write, so it can be awaited. */
class AutoBackend implements StorageBackend {
  private chosen: StorageBackend | null = null;
  private choosing: Promise<StorageBackend> | null = null;

  get kind(): StorageBackend["kind"] {
    return this.chosen?.kind ?? "opfs";
  }

  private store(): Promise<StorageBackend> {
    this.choosing ??= chooseBackend().then((backend) => (this.chosen = backend));
    return this.choosing;
  }

  async put(path: string, data: ArrayBuffer | string): Promise<void> {
    return (await this.store()).put(path, data);
  }

  async get(path: string): Promise<ArrayBuffer | null> {
    return (await this.store()).get(path);
  }

  async remove(path: string): Promise<void> {
    return (await this.store()).remove(path);
  }

  async list(prefix: string): Promise<string[]> {
    return (await this.store()).list(prefix);
  }
}

let backend: StorageBackend | null = null;

export function getBackend(): StorageBackend {
  backend ??= new AutoBackend();
  return backend;
}

export function setBackend(next: StorageBackend | null): void {
  backend = next;
}

export async function requestPersistence(): Promise<boolean> {
  try {
    if (await navigator.storage?.persisted?.()) return true;
    return (await navigator.storage?.persist?.()) ?? false;
  } catch {
    return false;
  }
}

export async function storageEstimate(): Promise<{ usage: number; quota: number } | null> {
  try {
    const { usage, quota } = (await navigator.storage?.estimate?.()) ?? {};
    if (usage === undefined || quota === undefined) return null;
    return { usage, quota };
  } catch {
    return null;
  }
}

/** Metadata for a DEM in the shared store. */
export interface DemEntry {
  key: string;
  bbox: Bbox;
  width: number;
  height: number;
  sourceUrl: string;
  fetchedAt: string;
  byteLength: number;
  source: "GLO30" | "UPLOAD";
  /** What this download was sized to cover, for the stored terrain list. */
  label?: string;
}

export type PlanDem = Omit<DemEntry, "key"> & { key?: string };

export interface PlanMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  areaM2?: number;
  bbox?: Bbox;
  /** Used to detect local changes after seeding. */
  seededAt?: string;
  generatedAt?: string;
  dem?: PlanDem;
  projectId?: string;
  projectName?: string;
  taskId?: string;
  projectBbox?: Bbox;
}

export const UNGROUPED = "unassigned";

export function planGroup(id: string): string {
  const slash = id.indexOf("/");
  return slash === -1 ? UNGROUPED : id.slice(0, slash);
}

/** Keep project ids to one safe path segment. */
export function groupSegment(projectId?: string): string {
  const slug = (projectId ?? "").replace(/[^\w-]+/g, "-").slice(0, 64);
  return slug && slug !== UNGROUPED ? slug : UNGROUPED;
}

const planDir = (id: string) => `plans/${id}`;

export const planPath = {
  aoi: (id: string) => `${planDir(id)}/aoi.geojson`,
  params: (id: string) => `${planDir(id)}/params.json`,
  dem: (id: string) => `${planDir(id)}/dem.tif`,
  meta: (id: string) => `${planDir(id)}/meta.json`,
};

export async function readJson<T>(path: string): Promise<T | null> {
  const bytes = await getBackend().get(path);
  if (!bytes) return null;
  try {
    return JSON.parse(new TextDecoder().decode(bytes)) as T;
  } catch {
    return null;
  }
}

export async function writeJson(path: string, value: unknown): Promise<void> {
  await getBackend().put(path, JSON.stringify(value, null, 2));
}

export async function listPlans(): Promise<PlanMeta[]> {
  const backend = getBackend();
  const metas: Array<PlanMeta | null> = [];

  for (const entry of await backend.list("plans")) {
    // Read legacy flat plan folders before migration too.
    const flat = await readJson<PlanMeta>(planPath.meta(entry));
    if (flat) {
      metas.push(flat);
      continue;
    }

    const nested = await backend.list(`plans/${entry}`);
    metas.push(
      ...(await Promise.all(
        nested.map((id) => readJson<PlanMeta>(planPath.meta(`${entry}/${id}`))),
      )),
    );
  }

  return metas
    .filter((m): m is PlanMeta => m !== null)
    .sort((a, b) => b.updatedAt.localeCompare(a.updatedAt));
}

export async function deletePlan(id: string): Promise<void> {
  await getBackend().remove(planDir(id));
}

// Callers control updatedAt because it determines list order.
export async function updatePlanMeta(
  id: string,
  patch: (meta: PlanMeta) => void,
): Promise<PlanMeta | null> {
  const meta = await readJson<PlanMeta>(planPath.meta(id));
  if (!meta) return null;
  patch(meta);
  await writeJson(planPath.meta(id), meta);
  return meta;
}

export const demPath = {
  tif: (key: string) => `dems/${key}.tif`,
  meta: (key: string) => `dems/${key}.json`,
};

const gridIndex = (value: number) => Math.round((value - GRID_ORIGIN) / PIXEL_DEG);

/** Keys GLO-30 crops by their snapped grid bounds. */
export function glo30DemKey(bbox: Bbox): string {
  const [minx, miny, maxx, maxy] = bbox.map(gridIndex);
  return `glo30_${minx}_${miny}_${maxx}_${maxy}`;
}

/** 96 bits of SHA-256: enough to keep one pilot's files apart. */
const HASH_HEX_CHARS = 24;

function fnv1a(bytes: ArrayBuffer): string {
  const view = new Uint8Array(bytes);
  let hash = 0x811c9dc5;
  for (let i = 0; i < view.length; i++) {
    hash ^= view[i];
    hash = Math.imul(hash, 0x01000193) >>> 0;
  }
  return hash.toString(16).padStart(8, "0");
}

/** Hashes uploaded DEMs to prevent key collisions. */
export async function contentHash(bytes: ArrayBuffer): Promise<string> {
  try {
    const digest = await crypto.subtle.digest("SHA-256", bytes);
    return [...new Uint8Array(digest)]
      .map((byte) => byte.toString(16).padStart(2, "0"))
      .join("")
      .slice(0, HASH_HEX_CHARS);
  } catch {
    // crypto.subtle needs a secure context; the app still runs without one.
    return `${fnv1a(bytes)}${bytes.byteLength.toString(36)}`;
  }
}

export async function uploadDemKey(name: string, bytes: ArrayBuffer): Promise<string> {
  const slug =
    name
      .replace(/\.[^.]+$/, "")
      .replace(/[^\w-]+/g, "-")
      .slice(0, 40) || "dem";
  return `upload_${slug}_${await contentHash(bytes)}`;
}

export async function demKeyFor(dem: PlanDem, bytes: ArrayBuffer): Promise<string> {
  return dem.source === "UPLOAD"
    ? uploadDemKey(dem.sourceUrl.replace(/^upload:/, ""), bytes)
    : glo30DemKey(dem.bbox);
}

export async function putDem(entry: DemEntry, bytes: ArrayBuffer): Promise<void> {
  await getBackend().put(demPath.tif(entry.key), bytes);
  await writeJson(demPath.meta(entry.key), entry);
}

export async function getDemBytes(key: string): Promise<ArrayBuffer | null> {
  return getBackend().get(demPath.tif(key));
}

export async function listDems(): Promise<DemEntry[]> {
  const names = await getBackend().list("dems");
  const keys = names.filter((name) => name.endsWith(".json")).map((name) => name.slice(0, -5));
  const entries = await Promise.all(keys.map((key) => readJson<DemEntry>(demPath.meta(key))));
  return entries
    .filter((entry): entry is DemEntry => entry !== null)
    .sort((a, b) => b.fetchedAt.localeCompare(a.fetchedAt));
}

/** Finds the smallest covering DEM, defaulting to GLO-30. */
export async function findCoveringDem(
  bbox: Bbox,
  options: { source?: DemEntry["source"]; marginDeg?: number } = {},
): Promise<DemEntry | null> {
  const { source = "GLO30", marginDeg = COVERAGE_MARGIN_PX * PIXEL_DEG } = options;
  const covering = (await listDems())
    .filter((entry) => entry.source === source && bboxContains(entry.bbox, bbox, marginDeg))
    .sort((a, b) => a.width * a.height - b.width * b.height);

  for (const entry of covering) {
    // A meta file can outlive its raster if storage was evicted mid-write.
    if (await getDemBytes(entry.key)) return entry;
  }
  return null;
}

export async function terrainCoverage(plans: PlanMeta[]): Promise<Set<string>> {
  const ready = new Set<string>();
  const pending: PlanMeta[] = [];
  for (const plan of plans) {
    if (plan.dem) ready.add(plan.id);
    else if (plan.bbox) pending.push(plan);
  }
  if (pending.length === 0) return ready;

  const dems = await listDems();
  const margin = COVERAGE_MARGIN_PX * PIXEL_DEG;
  for (const plan of pending) {
    if (dems.some((dem) => bboxContains(dem.bbox, plan.bbox!, margin))) ready.add(plan.id);
  }
  return ready;
}

export async function demUsage(): Promise<Map<string, string[]>> {
  const usage = new Map<string, string[]>();
  for (const plan of await listPlans()) {
    const key = plan.dem?.key;
    if (!key) continue;
    usage.set(key, [...(usage.get(key) ?? []), plan.id]);
  }
  return usage;
}

export async function detachPlanDem(id: string): Promise<void> {
  await getBackend().remove(planPath.dem(id));
  await updatePlanMeta(id, (meta) => {
    delete meta.dem;
  });
  // Freeing this plan's terrain is a request for the space back, so its own
  // extent does not count as a reason to keep the crop.
  await pruneUnusedDems([id]);
}

export async function deleteStoredDem(key: string): Promise<void> {
  for (const plan of await listPlans()) {
    if (plan.dem?.key !== key) continue;
    await updatePlanMeta(plan.id, (meta) => {
      delete meta.dem;
    });
  }
  const backend = getBackend();
  await backend.remove(demPath.tif(key));
  await backend.remove(demPath.meta(key));
}

export async function pruneUnusedDems(ignorePlanIds: string[] = []): Promise<number> {
  return removeDems(await listDems(), ignorePlanIds);
}

/** Removes unreferenced DEMs after a reuse window. */
export async function pruneStaleDems(maxAgeDays = 90): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  return removeDems(
    (await listDems()).filter((entry) => {
      const fetched = Date.parse(entry.fetchedAt);
      return !Number.isFinite(fetched) || fetched < cutoff;
    }),
  );
}

/**
 * A crop is in use when a plan points at it, and also when it simply covers
 * one: a seeded task carries no reference until it is opened, so going by
 * references alone would throw away the terrain a whole project is relying on.
 */
async function removeDems(entries: DemEntry[], ignorePlanIds: string[] = []): Promise<number> {
  const ignored = new Set(ignorePlanIds);
  const plans = (await listPlans()).filter((plan) => !ignored.has(plan.id));
  const referenced = new Set(plans.flatMap((plan) => (plan.dem?.key ? [plan.dem.key] : [])));
  const margin = COVERAGE_MARGIN_PX * PIXEL_DEG;

  const orphans = entries.filter(
    (entry) =>
      !referenced.has(entry.key) &&
      !plans.some((plan) => plan.bbox && bboxContains(entry.bbox, plan.bbox, margin)),
  );

  const backend = getBackend();
  for (const entry of orphans) {
    await backend.remove(demPath.tif(entry.key));
    await backend.remove(demPath.meta(entry.key));
  }
  return orphans.length;
}

async function copyTree(from: string, to: string): Promise<void> {
  const backend = getBackend();
  for (const name of await backend.list(from)) {
    const bytes = await backend.get(`${from}/${name}`);
    if (bytes) await backend.put(`${to}/${name}`, bytes);
    else await copyTree(`${from}/${name}`, `${to}/${name}`);
  }
}

/** Move legacy flat plan folders under their project. */
export async function migratePlanLayout(): Promise<number> {
  const backend = getBackend();
  let moved = 0;

  for (const entry of await backend.list("plans")) {
    const meta = await readJson<PlanMeta>(`plans/${entry}/meta.json`);
    if (!meta) continue;

    const id = `${groupSegment(meta.projectId)}/${entry}`;
    await copyTree(`plans/${entry}`, planDir(id));
    meta.id = id;
    meta.bbox ??= (await planBbox(id)) ?? undefined;
    await writeJson(planPath.meta(id), meta);
    await backend.remove(`plans/${entry}`);
    moved += 1;
  }

  return moved;
}

export async function readPlanRing(id: string): Promise<Array<[number, number]> | null> {
  const aoi = await readJson<{
    features?: Array<{ geometry?: { coordinates?: Array<Array<[number, number]>> } }>;
  }>(planPath.aoi(id));
  const ring = aoi?.features?.[0]?.geometry?.coordinates?.[0];
  return ring?.length ? ring : null;
}

export async function readPlanRings(
  plans: PlanMeta[],
): Promise<Map<string, Array<[number, number]>>> {
  const rings = await Promise.all(plans.map((plan) => readPlanRing(plan.id)));
  return new Map(
    plans.flatMap((plan, index) => {
      const ring = rings[index];
      return ring ? [[plan.id, ring] as const] : [];
    }),
  );
}

async function planBbox(id: string): Promise<Bbox | null> {
  const ring = await readPlanRing(id);
  if (!ring) return null;

  const params = await readJson<{ takeoffPoint?: { lon: number; lat: number } | null }>(
    planPath.params(id),
  );
  return bboxIncludingPoint(ringBbox(ring), params?.takeoffPoint ?? null);
}

/** Moves legacy per-plan DEMs into the shared store. */
export async function migrateLegacyDems(): Promise<number> {
  let moved = 0;
  const backend = getBackend();

  for (const plan of await listPlans()) {
    const dem = plan.dem;
    if (!dem || dem.key) continue;

    const bytes = await backend.get(planPath.dem(plan.id));
    if (!bytes) {
      await updatePlanMeta(plan.id, (meta) => {
        delete meta.dem;
      });
      continue;
    }

    const key = await demKeyFor(dem, bytes);
    await putDem({ ...dem, key, byteLength: bytes.byteLength }, bytes);
    await updatePlanMeta(plan.id, (meta) => {
      if (meta.dem) meta.dem.key = key;
    });
    await backend.remove(planPath.dem(plan.id));
    moved++;
  }

  return moved;
}

// Check the AOI file so plans created before areaM2 are preserved.
export async function pruneEmptyPlans(maxAgeDays = 7): Promise<number> {
  const cutoff = Date.now() - maxAgeDays * 24 * 60 * 60 * 1000;
  const stale = (await listPlans()).filter((plan) => {
    const updated = Date.parse(plan.updatedAt);
    return Number.isFinite(updated) && updated < cutoff;
  });

  let removed = 0;
  for (const plan of stale) {
    if (await getBackend().get(planPath.aoi(plan.id))) continue;
    await deletePlan(plan.id);
    removed += 1;
  }
  return removed;
}

export function newPlanId(projectId?: string): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  const day = new Date().toISOString().slice(0, 10);
  return `${groupSegment(projectId)}/${day}-${rand}`;
}

let maintenance: Promise<void> | null = null;

export function startupMaintenance(): Promise<void> {
  maintenance ??= (async () => {
    await migratePlanLayout();
    await migrateLegacyDems();
    await pruneEmptyPlans();
    await pruneStaleDems();
  })().catch(() => {});
  return maintenance;
}
