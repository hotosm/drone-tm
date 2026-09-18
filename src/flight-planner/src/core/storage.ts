// OPFS storage with an IndexedDB fallback.

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

let backend: StorageBackend | null = null;

export function getBackend(): StorageBackend {
  if (backend) return backend;
  const hasOpfs =
    typeof navigator !== "undefined" && typeof navigator.storage?.getDirectory === "function";
  backend = hasOpfs ? new OpfsBackend() : new IdbBackend();
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

export interface PlanMeta {
  id: string;
  name: string;
  createdAt: string;
  updatedAt: string;
  areaM2?: number;
  generatedAt?: string;
  dem?: {
    bbox: [number, number, number, number];
    width: number;
    height: number;
    sourceUrl: string;
    fetchedAt: string;
    byteLength: number;
    source: "GLO30" | "UPLOAD";
  };
  projectId?: string;
  taskId?: string;
}

const planDir = (id: string) => `plans/${id}`;

export const planPath = {
  aoi: (id: string) => `${planDir(id)}/aoi.geojson`,
  params: (id: string) => `${planDir(id)}/params.json`,
  dem: (id: string) => `${planDir(id)}/dem.tif`,
  meta: (id: string) => `${planDir(id)}/meta.json`,
  output: (id: string, name: string) => `${planDir(id)}/out/${name}`,
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
  const ids = await getBackend().list("plans");
  const metas = await Promise.all(ids.map((id) => readJson<PlanMeta>(planPath.meta(id))));
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

export async function deleteDem(id: string): Promise<void> {
  await getBackend().remove(planPath.dem(id));
  await updatePlanMeta(id, (meta) => {
    delete meta.dem;
  });
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

export function newPlanId(): string {
  const rand =
    typeof crypto !== "undefined" && "randomUUID" in crypto
      ? crypto.randomUUID().slice(0, 8)
      : Math.random().toString(36).slice(2, 10);
  return `${new Date().toISOString().slice(0, 10)}-${rand}`;
}
