import { setBackend, type StorageBackend } from "../src/core/storage";

/** The OPFS contract, in a Map - shared by the storage tests. */
export class MemoryBackend implements StorageBackend {
  readonly kind = "opfs" as const;
  readonly files = new Map<string, ArrayBuffer>();

  async put(path: string, data: ArrayBuffer | string): Promise<void> {
    this.files.set(
      path,
      typeof data === "string" ? (new TextEncoder().encode(data).buffer as ArrayBuffer) : data,
    );
  }

  async get(path: string): Promise<ArrayBuffer | null> {
    return this.files.get(path) ?? null;
  }

  async remove(path: string): Promise<void> {
    for (const key of [...this.files.keys()]) {
      if (key === path || key.startsWith(`${path}/`)) this.files.delete(key);
    }
  }

  async list(prefix: string): Promise<string[]> {
    const base = prefix.endsWith("/") ? prefix : `${prefix}/`;
    const names = new Set<string>();
    for (const key of this.files.keys()) {
      if (!key.startsWith(base)) continue;
      const rest = key.slice(base.length);
      if (rest) names.add(rest.split("/")[0]);
    }
    return [...names].sort();
  }
}

export function useMemory(): MemoryBackend {
  const backend = new MemoryBackend();
  setBackend(backend);
  return backend;
}
