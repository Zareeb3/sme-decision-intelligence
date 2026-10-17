/**
 * Browser-side persistence, used when the server has no storage (for example
 * a Vercel deployment) and for per-user preferences.
 *
 * - Datasets (canonical CSV text) live in IndexedDB: too large for localStorage.
 * - Settings, saved column mappings and preferences live in localStorage.
 * Every call is wrapped so private windows or blocked storage never break the app.
 */
import type { DatasetKind } from "../data/types";
import type { ColumnMapping } from "../data/mapping";

const DB_NAME = "decision-intelligence";
const STORE = "datasets";

export interface StoredDataset {
  kind: DatasetKind;
  csv: string;
  rows: number;
  updatedAt: string;
  fileName: string;
}

function openDb(): Promise<IDBDatabase | null> {
  return new Promise((resolve) => {
    try {
      if (typeof indexedDB === "undefined") return resolve(null);
      const req = indexedDB.open(DB_NAME, 1);
      req.onupgradeneeded = () => req.result.createObjectStore(STORE, { keyPath: "kind" });
      req.onsuccess = () => resolve(req.result);
      req.onerror = () => resolve(null);
    } catch {
      resolve(null);
    }
  });
}

export async function saveBrowserDataset(d: StoredDataset): Promise<boolean> {
  const db = await openDb();
  if (!db) return false;
  return new Promise((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      tx.objectStore(STORE).put(d);
      tx.oncomplete = () => resolve(true);
      tx.onerror = () => resolve(false);
    } catch {
      resolve(false);
    }
  });
}

export async function loadBrowserDatasets(): Promise<StoredDataset[]> {
  const db = await openDb();
  if (!db) return [];
  return new Promise((resolve) => {
    try {
      const req = db.transaction(STORE, "readonly").objectStore(STORE).getAll();
      req.onsuccess = () => resolve((req.result as StoredDataset[]) ?? []);
      req.onerror = () => resolve([]);
    } catch {
      resolve([]);
    }
  });
}

export async function deleteBrowserDataset(kind?: DatasetKind): Promise<void> {
  const db = await openDb();
  if (!db) return;
  await new Promise<void>((resolve) => {
    try {
      const tx = db.transaction(STORE, "readwrite");
      if (kind) tx.objectStore(STORE).delete(kind);
      else tx.objectStore(STORE).clear();
      tx.oncomplete = () => resolve();
      tx.onerror = () => resolve();
    } catch {
      resolve();
    }
  });
}

function readJson<T>(key: string, fallback: T): T {
  try {
    const v = localStorage.getItem(key);
    return v ? (JSON.parse(v) as T) : fallback;
  } catch {
    return fallback;
  }
}

function writeJson(key: string, value: unknown) {
  try {
    localStorage.setItem(key, JSON.stringify(value));
  } catch {
    /* storage unavailable: setting applies for this session only */
  }
}

export const prefs = {
  settings: () => readJson<unknown | null>("sdi.settings", null),
  saveSettings: (s: unknown) => writeJson("sdi.settings", s),
  mappings: () => readJson<Partial<Record<DatasetKind, { headers: string[]; mapping: ColumnMapping }>>>("sdi.mappings", {}),
  saveMapping: (kind: DatasetKind, headers: string[], mapping: ColumnMapping) => {
    const all = prefs.mappings();
    all[kind] = { headers, mapping };
    writeJson("sdi.mappings", all);
  },
  hideSample: () => readJson<boolean>("sdi.hideSample", false),
  setHideSample: (v: boolean) => writeJson("sdi.hideSample", v),
  setupDone: () => readJson<boolean>("sdi.setupDone", false),
  setSetupDone: (v: boolean) => writeJson("sdi.setupDone", v),
};
