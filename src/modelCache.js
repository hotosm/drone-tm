// Persist downloaded model GLBs in IndexedDB so a dev reload (HMR after a code
// change) doesn't re-download the 10 MB low-res + 61 MB high-res every time.
// IndexedDB (not the Cache Storage API) because it works in NON-secure contexts
// too — the dev test URL is plain http over Tailscale, where `caches` is absent.
// Values are stored as Blobs: iOS Safari handles large binary in IndexedDB far
// more reliably as a Blob (file-backed) than as a raw ArrayBuffer (which it
// structured-clones into memory and can reject/evict). Entries carry a
// timestamp and expire after TTL_MS (~2 days).

const DB_NAME = "dmt-models";
const STORE = "glb";
const TTL_MS = 2 * 24 * 60 * 60 * 1000; // 2 days

// Ask the browser not to evict our storage (best-effort; ignored where
// unsupported). Fire once.
let persistAsked = false;
function requestPersist() {
  if (persistAsked) return;
  persistAsked = true;
  try {
    navigator.storage?.persist?.().then(
      (granted) => console.log(`[cache] persistent storage: ${granted ? "granted" : "denied"}`),
      () => {}
    );
  } catch (e) {
    /* no-op */
  }
}

function openDB() {
  return new Promise((resolve, reject) => {
    if (typeof indexedDB === "undefined") return reject(new Error("no indexedDB"));
    const req = indexedDB.open(DB_NAME, 1);
    req.onupgradeneeded = () => {
      const db = req.result;
      if (!db.objectStoreNames.contains(STORE)) db.createObjectStore(STORE);
    };
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbGet(db, key) {
  return new Promise((resolve, reject) => {
    const req = db.transaction(STORE, "readonly").objectStore(STORE).get(key);
    req.onsuccess = () => resolve(req.result || null);
    req.onerror = () => reject(req.error);
  });
}

function idbPut(db, key, value) {
  return new Promise((resolve, reject) => {
    const tx = db.transaction(STORE, "readwrite");
    tx.objectStore(STORE).put(value, key);
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error || new Error("idb put failed"));
    tx.onabort = () => reject(tx.error || new Error("idb put aborted (quota?)"));
  });
}

// Fetch a URL's bytes as an ArrayBuffer, served from the IndexedDB cache when a
// fresh copy exists. onProgress({loaded,total}) fires while downloading (and
// once at 100% on a cache hit). Non-http(s) URLs (blob:/data: from drag-drop)
// bypass the cache. Any cache failure falls back to a plain network fetch.
export async function cachedArrayBuffer(url, onProgress, ttlMs = TTL_MS, onStatus) {
  const note = (s) => {
    console.log(`[cache] ${s} ${url}`);
    if (onStatus) onStatus(s);
  };
  // Cache everything except ephemeral object URLs (drag-drop blob:/data:).
  // This deliberately INCLUDES same-origin relative paths like
  // "/resources/models/coconut-low.glb" — the local dev copy, which the old
  // http(s)-only guard silently skipped (so it never cached locally).
  const cacheable = !/^(blob:|data:)/i.test(url);
  let db = null;
  if (cacheable) {
    requestPersist();
    try {
      db = await openDB();
    } catch (e) {
      note("unavailable (blocked?)");
      console.warn("[cache] indexedDB unavailable → network only", e);
    }
  }

  if (db) {
    try {
      const rec = await idbGet(db, url);
      if (rec && rec.blob && Date.now() - rec.ts < ttlMs) {
        const buf = await rec.blob.arrayBuffer();
        if (onProgress) onProgress({ loaded: buf.byteLength, total: buf.byteLength });
        const ageH = Math.round((Date.now() - rec.ts) / 3.6e6);
        note(`HIT (${(buf.byteLength / 1e6).toFixed(1)}MB, ${ageH}h old)`);
        return buf;
      }
      note("miss → downloading");
    } catch (e) {
      note("read failed → downloading");
      console.warn("[cache] read failed → network", e);
    }
  }

  const res = await fetch(url);
  if (!res.ok) throw new Error(`fetch failed: ${res.status} for ${url}`);
  const total = Number(res.headers.get("content-length") || 0);

  let buf;
  if (res.body && typeof res.body.getReader === "function") {
    const reader = res.body.getReader();
    const chunks = [];
    let loaded = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      chunks.push(value);
      loaded += value.length;
      if (onProgress && total) onProgress({ loaded, total });
    }
    const out = new Uint8Array(loaded);
    let off = 0;
    for (const c of chunks) {
      out.set(c, off);
      off += c.length;
    }
    buf = out.buffer;
  } else {
    buf = await res.arrayBuffer();
  }

  if (db) {
    try {
      await idbPut(db, url, { ts: Date.now(), blob: new Blob([buf]) });
      note(`STORED (${(buf.byteLength / 1e6).toFixed(1)}MB)`);
    } catch (e) {
      note("store failed (quota?)");
      console.warn(`[cache] store failed for ${url} (quota/eviction?)`, e);
    }
  }
  return buf;
}
