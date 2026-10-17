"use client";

/**
 * Loads data and settings for every page and decides where they come from.
 *
 * Order of precedence:
 *   1. Company data stored on the server (pipeline, drop folder or uploads)
 *   2. Company data uploaded earlier in this browser (when the server has no storage)
 *   3. The bundled sample data, unless disabled by the server or hidden by the user
 *   4. Nothing: the app shows the setup wizard
 *
 * Analytics always run in the browser on the validated data.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildBundle, fetchSampleTexts, type CsvTexts, type LoadResult } from "@/lib/data/load";
import { buildModel, type Model } from "@/lib/analytics/model";
import { defaultFilters, type Filters } from "@/lib/analytics/filters";
import { NEW_COMPANY_SETTINGS, parseSettings, SAMPLE_SETTINGS, setSettings, type CompanySettings } from "@/lib/settings";
import { deleteBrowserDataset, loadBrowserDatasets, prefs, saveBrowserDataset } from "@/lib/client/browserStore";
import { toCsv } from "@/lib/data/csv";
import { DATASET_SPECS } from "@/lib/data/schemas";
import type { DataBundle, DatasetKind } from "@/lib/data/types";
import type { DatasetMeta, Manifest } from "@/lib/server/storage";
import type { ValidationResult } from "@/lib/data/validate";
import { withCases } from "@/lib/complaints/merge";
import { taxonomyForModel } from "@/lib/complaints/context";
import { buildSampleRegister, type SeedCase } from "@/lib/complaints/seed";
import type { ComplaintCase } from "@/lib/complaints/types";
import { browserCaseStore, serverCaseStore, type CaseStore } from "@/lib/client/caseStore";

type Status = "loading" | "ready" | "empty" | "error";
export type DataOrigin = "server" | "browser" | "sample";

export interface ServerInfo {
  reachable: boolean;
  storage: { enabled: boolean; reason: string; dir?: string | null };
  manifest: Manifest;
  sampleEnabled: boolean;
  ingestConfigured: boolean;
  dropFolder: string | null;
}

export interface SaveOutcome {
  ok: boolean;
  messages: string[];
  where: "server" | "browser";
}

interface DataContextValue {
  status: Status;
  error: string | null;
  model: Model | null;
  loadResult: LoadResult | null;
  origin: DataOrigin | null;
  /** Per-dataset details for the current company data (server manifest or browser store). */
  datasets: Partial<Record<DatasetKind, { rows: number; updatedAt: string; source: string; by: string }>>;
  server: ServerInfo;
  settings: CompanySettings;
  filters: Filters;
  setFilters: (f: Filters) => void;
  resetFilters: () => void;
  reload: () => Promise<void>;
  loadSample: () => Promise<void>;
  /** Save validated datasets (from the upload screen) to the server or this browser, then reload. */
  saveDatasets: (results: Partial<Record<DatasetKind, ValidationResult>>, fileNames: Partial<Record<DatasetKind, string>>, by: string) => Promise<SaveOutcome>;
  removeCompanyData: (kind?: DatasetKind) => Promise<void>;
  rollbackDataset: (kind: DatasetKind) => Promise<string>;
  saveSettings: (s: CompanySettings) => Promise<string>;
  setHideSample: (hide: boolean) => Promise<void>;
  hideSample: boolean;
  /** Model without the complaint register (imported data only). */
  baseModel: Model | null;
  /** Complaint register for the current data origin. */
  cases: ComplaintCase[];
  casesState: "idle" | "loading" | "ready" | "error";
  casesError: string | null;
  caseStore: CaseStore | null;
  /** Replace one case in memory after a change was saved. */
  putCase: (c: ComplaintCase) => void;
  refreshCases: () => Promise<void>;
  resetSampleCases: () => Promise<void>;
  /** "Now" for response-time targets: the data snapshot for sample data, the real time otherwise. */
  registerNow: () => Date;
}

const EMPTY_FILTERS: Filters = { start: "", end: "", regions: [], channels: [], categories: [], productIds: [] };
const NO_SERVER: ServerInfo = {
  reachable: false,
  storage: { enabled: false, reason: "The server could not be reached; data stays in this browser." },
  manifest: {},
  sampleEnabled: true,
  ingestConfigured: false,
  dropFolder: null,
};

const DataContext = createContext<DataContextValue | null>(null);

async function fetchJson<T>(url: string): Promise<T | null> {
  try {
    const r = await fetch(url, { cache: "no-store" });
    return r.ok ? ((await r.json()) as T) : null;
  } catch {
    return null;
  }
}

const hasRequired = (kinds: string[]) => ["orders", "customers", "invoices"].every((k) => kinds.includes(k));

export function DataProvider({ children, sampleBasePath = "/sample-data" }: { children: ReactNode; sampleBasePath?: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [cases, setCases] = useState<ComplaintCase[]>([]);
  const [casesState, setCasesState] = useState<DataContextValue["casesState"]>("idle");
  const [casesError, setCasesError] = useState<string | null>(null);
  const [caseStore, setCaseStore] = useState<CaseStore | null>(null);
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);
  const [origin, setOrigin] = useState<DataOrigin | null>(null);
  const [datasets, setDatasets] = useState<DataContextValue["datasets"]>({});
  const [server, setServer] = useState<ServerInfo>(NO_SERVER);
  const [settings, setSettingsState] = useState<CompanySettings>(SAMPLE_SETTINGS);
  const [companySettings, setCompanySettings] = useState<CompanySettings>(NEW_COMPANY_SETTINGS);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);
  const [hideSample, setHideSampleState] = useState(false);

  const activate = useCallback((res: LoadResult, from: DataOrigin, s: CompanySettings) => {
    setSettings(s); // analytics read settings globally; set before building views
    setSettingsState(s);
    setLoadResult(res);
    setOrigin(from);
    if (res.bundle) {
      const m = buildModel(res.bundle);
      setModel(m);
      setFilters(defaultFilters(m));
      setStatus("ready");
      setError(null);
    } else {
      setModel(null);
      setStatus("error");
      setError(res.blockingErrors.join(" "));
    }
  }, []);

  const loadSampleNow = useCallback(async () => {
    const texts = await fetchSampleTexts(sampleBasePath);
    activate(buildBundle(texts, "sample"), "sample", SAMPLE_SETTINGS);
    setDatasets({});
  }, [activate, sampleBasePath]);

  const reload = useCallback(async () => {
    setStatus("loading");
    const hide = prefs.hideSample();
    setHideSampleState(hide);
    // 1. server
    const info = await fetchJson<Omit<ServerInfo, "reachable">>("/api/data");
    const srv: ServerInfo = info ? { ...NO_SERVER, ...info, reachable: true } : NO_SERVER;
    setServer(srv);
    const serverSettings = srv.storage.enabled ? (await fetchJson<{ settings: unknown }>("/api/settings"))?.settings : null;
    const company = parseSettings(serverSettings ?? prefs.settings() ?? NEW_COMPANY_SETTINGS);
    setCompanySettings(company);

    try {
      const serverKinds = Object.keys(srv.manifest) as DatasetKind[];
      if (srv.storage.enabled && hasRequired(serverKinds)) {
        const texts: CsvTexts = {};
        await Promise.all(
          serverKinds.map(async (k) => {
            const r = await fetch(`/api/data/${k}`, { cache: "no-store" });
            if (r.ok) texts[k] = await r.text();
          }),
        );
        const fromPipeline = serverKinds.some((k) => srv.manifest[k]?.source !== "upload");
        activate(buildBundle(texts, fromPipeline ? "pipeline" : "upload"), "server", company);
        setDatasets(Object.fromEntries(serverKinds.map((k) => [k, srv.manifest[k] as DatasetMeta])));
        return;
      }
      // 2. browser
      const stored = await loadBrowserDatasets();
      if (hasRequired(stored.map((d) => d.kind))) {
        const texts = Object.fromEntries(stored.map((d) => [d.kind, d.csv])) as CsvTexts;
        activate(buildBundle(texts, "upload"), "browser", company);
        setDatasets(Object.fromEntries(stored.map((d) => [d.kind, { rows: d.rows, updatedAt: d.updatedAt, source: "upload", by: d.fileName }])));
        return;
      }
      // 3. sample
      if (srv.sampleEnabled && !hide) {
        await loadSampleNow();
        return;
      }
      // 4. nothing yet
      setSettings(company);
      setSettingsState(company);
      setModel(null);
      setLoadResult(null);
      setOrigin(null);
      setDatasets({});
      setStatus("empty");
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }, [activate, loadSampleNow]);

  useEffect(() => {
    void reload();
  }, [reload]);

  const loadCases = useCallback(
    async (m: Model, from: DataOrigin, opts: { reseed?: boolean; silent?: boolean } = {}) => {
      if (!opts.silent) setCasesState("loading");
      try {
        const store = from === "server" ? serverCaseStore() : await browserCaseStore(from === "sample" ? "sample" : "company");
        let list = await store.list();
        if (from === "sample" && store.replaceAll && (opts.reseed || list.length === 0)) {
          const seed = await fetch(`${sampleBasePath}/complaint_texts.json`).then((r) => (r.ok ? (r.json() as Promise<{ cases: SeedCase[] }>) : null)).catch(() => null);
          if (seed) {
            list = await buildSampleRegister(m, seed.cases, taxonomyForModel(m));
            await store.replaceAll(list);
          }
        }
        setCaseStore(store);
        setCases(list);
        setCasesState("ready");
        setCasesError(null);
      } catch (e) {
        setCases([]);
        setCasesState("error");
        setCasesError((e as Error).message);
      }
    },
    [sampleBasePath],
  );

  useEffect(() => {
    if (!model || !origin) {
      setCases([]);
      setCaseStore(null);
      setCasesState("idle");
      return;
    }
    void loadCases(model, origin);
  }, [model, origin, loadCases]);

  const mergedModel = useMemo(() => (model ? withCases(model, cases) : null), [model, cases]);
  const putCase = useCallback((c: ComplaintCase) => setCases((xs) => (xs.some((x) => x.id === c.id) ? xs.map((x) => (x.id === c.id ? c : x)) : [...xs, c])), []);
  const refreshCases = useCallback(async () => {
    if (model && origin) await loadCases(model, origin, { silent: true });
  }, [model, origin, loadCases]);
  const resetSampleCases = useCallback(async () => {
    if (model && origin === "sample") await loadCases(model, origin, { reseed: true });
  }, [model, origin, loadCases]);
  const registerNow = useCallback(() => (origin === "sample" && model ? new Date(`${model.maxDate}T23:59:00Z`) : new Date()), [origin, model]);

  const loadSampleFn = useCallback(async () => {
    prefs.setHideSample(false);
    setHideSampleState(false);
    setStatus("loading");
    try {
      await loadSampleNow();
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }, [loadSampleNow]);

  const saveDatasets = useCallback<DataContextValue["saveDatasets"]>(
    async (results, fileNames, by) => {
      const messages: string[] = [];
      let ok = true;
      const where: SaveOutcome["where"] = server.storage.enabled ? "server" : "browser";
      for (const [kind, r] of Object.entries(results) as [DatasetKind, ValidationResult][]) {
        if (!r?.ok) continue;
        const csv = toCsv(r.rows as Record<string, unknown>[], DATASET_SPECS[kind].allColumns);
        if (where === "server") {
          try {
            const res = await fetch(`/api/data/${kind}`, { method: "PUT", body: csv, headers: { "content-type": "text/csv", "x-uploaded-by": by } });
            const body = (await res.json().catch(() => ({}))) as { ok?: boolean; message?: string; fileErrors?: string[]; rowsStored?: number };
            if (!res.ok || !body.ok) {
              ok = false;
              messages.push(`${DATASET_SPECS[kind].label}: ${body.message ?? body.fileErrors?.join(" ") ?? `HTTP ${res.status}`}`);
            } else messages.push(`${DATASET_SPECS[kind].label}: ${body.rowsStored} rows saved on the server.`);
          } catch {
            ok = false;
            messages.push(`${DATASET_SPECS[kind].label}: the server could not be reached.`);
          }
        } else {
          const saved = await saveBrowserDataset({ kind, csv, rows: r.validRows, updatedAt: new Date().toISOString(), fileName: fileNames[kind] ?? "upload" });
          if (!saved) {
            ok = false;
            messages.push(`${DATASET_SPECS[kind].label}: this browser does not allow saving data (private window?).`);
          } else messages.push(`${DATASET_SPECS[kind].label}: ${r.validRows} rows saved in this browser.`);
        }
      }
      await reload();
      return { ok, messages, where };
    },
    [server.storage.enabled, reload],
  );

  const removeCompanyData = useCallback(
    async (kind?: DatasetKind) => {
      if (server.storage.enabled) await fetch(kind ? `/api/data/${kind}` : "/api/data", { method: "DELETE" }).catch(() => null);
      await deleteBrowserDataset(kind);
      if (!kind) await (await browserCaseStore("company")).clear?.();
      await reload();
    },
    [server.storage.enabled, reload],
  );

  const rollbackDataset = useCallback(
    async (kind: DatasetKind) => {
      const r = await fetch(`/api/data/${kind}?action=rollback`, { method: "POST" }).catch(() => null);
      const body = r ? ((await r.json().catch(() => ({}))) as { message?: string }) : {};
      await reload();
      return body.message ?? "The server could not be reached.";
    },
    [reload],
  );

  const saveSettingsFn = useCallback(
    async (s: CompanySettings) => {
      prefs.saveSettings(s);
      setCompanySettings(s);
      let message = "Settings saved in this browser.";
      if (server.storage.enabled) {
        const r = await fetch("/api/settings", { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(s) }).catch(() => null);
        message = r?.ok ? "Settings saved for everyone using this server." : "Saved in this browser; the server did not accept the settings.";
      }
      if (origin !== "sample") {
        setSettings(s);
        setSettingsState(s);
        // rebuild filters so fiscal-year presets and views pick up the change
        if (model) setFilters((f) => ({ ...f }));
      }
      return message;
    },
    [server.storage.enabled, origin, model],
  );

  const setHideSampleFn = useCallback(
    async (hide: boolean) => {
      prefs.setHideSample(hide);
      setHideSampleState(hide);
      await reload();
    },
    [reload],
  );

  const value = useMemo<DataContextValue>(
    () => ({
      status,
      error,
      model: mergedModel,
      baseModel: model,
      cases,
      casesState,
      casesError,
      caseStore,
      putCase,
      refreshCases,
      resetSampleCases,
      registerNow,
      loadResult,
      origin,
      datasets,
      server,
      settings: origin === "sample" ? settings : companySettings,
      filters,
      setFilters,
      resetFilters: () => mergedModel && setFilters(defaultFilters(mergedModel)),
      reload,
      loadSample: loadSampleFn,
      saveDatasets,
      removeCompanyData,
      rollbackDataset,
      saveSettings: saveSettingsFn,
      setHideSample: setHideSampleFn,
      hideSample,
    }),
    [status, error, model, mergedModel, cases, casesState, casesError, caseStore, putCase, refreshCases, resetSampleCases, registerNow, loadResult, origin, datasets, server, settings, companySettings, filters, reload, loadSampleFn, saveDatasets, removeCompanyData, rollbackDataset, saveSettingsFn, setHideSampleFn, hideSample],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}

/** For pages that need loaded data. `settings` is included so views recompute when settings change. */
export function useReadyData(): { model: Model; filters: Filters; settings: CompanySettings } | null {
  const { status, model, filters, settings } = useData();
  return useMemo(() => (status !== "ready" || !model || !filters.start ? null : { model, filters, settings }), [status, model, filters, settings]);
}

export type { DataBundle };
