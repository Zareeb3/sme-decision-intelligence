"use client";

/**
 * Holds the loaded data, the derived model and the shared filters for every
 * page. Data stays in the browser: sample data is fetched from /sample-data,
 * uploads are read locally and are never sent to the server.
 */
import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import { buildBundle, fetchSampleTexts, type CsvTexts, type LoadResult } from "@/lib/data/load";
import { buildModel, type Model } from "@/lib/analytics/model";
import { defaultFilters, type Filters } from "@/lib/analytics/filters";

type Status = "loading" | "ready" | "error";

interface DataContextValue {
  status: Status;
  error: string | null;
  model: Model | null;
  loadResult: LoadResult | null;
  filters: Filters;
  setFilters: (f: Filters) => void;
  resetFilters: () => void;
  loadSample: () => Promise<void>;
  loadTexts: (texts: CsvTexts) => LoadResult;
}

const EMPTY_FILTERS: Filters = { start: "", end: "", regions: [], channels: [], categories: [], productIds: [] };

const DataContext = createContext<DataContextValue | null>(null);

export function DataProvider({ children, sampleBasePath = "/sample-data" }: { children: ReactNode; sampleBasePath?: string }) {
  const [status, setStatus] = useState<Status>("loading");
  const [error, setError] = useState<string | null>(null);
  const [model, setModel] = useState<Model | null>(null);
  const [loadResult, setLoadResult] = useState<LoadResult | null>(null);
  const [filters, setFilters] = useState<Filters>(EMPTY_FILTERS);

  const apply = useCallback((res: LoadResult) => {
    setLoadResult(res);
    if (res.bundle) {
      const m = buildModel(res.bundle);
      setModel(m);
      setFilters(defaultFilters(m));
      setStatus("ready");
      setError(null);
    }
    return res;
  }, []);

  const loadSample = useCallback(async () => {
    setStatus("loading");
    try {
      const texts = await fetchSampleTexts(sampleBasePath);
      const res = apply(buildBundle(texts, "sample"));
      if (!res.bundle) {
        setStatus("error");
        setError(res.blockingErrors.join(" "));
      }
    } catch (e) {
      setStatus("error");
      setError((e as Error).message);
    }
  }, [apply, sampleBasePath]);

  const loadTexts = useCallback((texts: CsvTexts) => apply(buildBundle(texts, "upload")), [apply]);

  useEffect(() => {
    void loadSample();
  }, [loadSample]);

  const value = useMemo<DataContextValue>(
    () => ({
      status,
      error,
      model,
      loadResult,
      filters,
      setFilters,
      resetFilters: () => model && setFilters(defaultFilters(model)),
      loadSample,
      loadTexts,
    }),
    [status, error, model, loadResult, filters, loadSample, loadTexts],
  );
  return <DataContext.Provider value={value}>{children}</DataContext.Provider>;
}

export function useData(): DataContextValue {
  const ctx = useContext(DataContext);
  if (!ctx) throw new Error("useData must be used inside <DataProvider>");
  return ctx;
}

/** For pages that need loaded data: returns model and filters, or null while loading. */
export function useReadyData(): { model: Model; filters: Filters } | null {
  const { status, model, filters } = useData();
  if (status !== "ready" || !model || !filters.start) return null;
  return { model, filters };
}
