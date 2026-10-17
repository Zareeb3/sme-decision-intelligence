"use client";

import { useMemo, useState } from "react";
import { useData } from "./DataProvider";
import { fiscalQuarterKey, fiscalYearOf, fiscalYearRange, monthEnd, monthsBetween } from "@/lib/analytics/dates";
import { asOfDate, defaultFilters, type Filters } from "@/lib/analytics/filters";
import { formatDate } from "@/lib/analytics/format";

interface Preset {
  id: string;
  label: string;
  start: string;
  end: string;
}

function MultiSelect({ label, plural, options, selected, onChange }: { label: string; plural: string; options: string[]; selected: string[]; onChange: (v: string[]) => void }) {
  const summary = selected.length === 0 ? `All ${plural}` : selected.length === 1 ? selected[0] : `${selected.length} ${plural}`;
  return (
    <details className="relative">
      <summary className={`flex h-9 items-center gap-2 rounded-md border px-3 text-[0.82rem] ${selected.length ? "border-glaze bg-glaze-soft text-glaze-deep" : "border-line-strong bg-surface text-ink"}`}>
        <span className="text-muted">{label}:</span>
        <span className="max-w-[10rem] truncate font-medium">{summary}</span>
        <span aria-hidden className="text-faint">▾</span>
      </summary>
      <div className="absolute left-0 top-11 z-40 w-60 rounded-md border border-line-strong bg-surface p-2 shadow-lg">
        {options.map((o) => (
          <label key={o} className="flex cursor-pointer items-center gap-2 rounded px-2 py-1.5 text-[0.85rem] hover:bg-paper">
            <input
              type="checkbox"
              className="accent-[var(--color-glaze)]"
              checked={selected.includes(o)}
              onChange={(e) => onChange(e.target.checked ? [...selected, o] : selected.filter((x) => x !== o))}
            />
            {o}
          </label>
        ))}
        {selected.length > 0 && (
          <button type="button" className="mt-1 w-full rounded px-2 py-1.5 text-left text-[0.8rem] text-glaze hover:bg-glaze-soft" onClick={() => onChange([])}>
            Clear selection
          </button>
        )}
      </div>
    </details>
  );
}

export function FilterBar() {
  const { model, filters, setFilters, status, settings } = useData();
  const [custom, setCustom] = useState(false);

  const fy = settings.fiscalYearStartMonth;
  const presets = useMemo<Preset[]>(() => {
    if (!model) return [];
    const d = defaultFilters(model);
    const lastComplete = d.end;
    const months = monthsBetween(model.minDate, lastComplete);
    const out: Preset[] = [{ id: "default", label: "Last 3 complete months", start: d.start, end: d.end }];
    // quarters (fiscal when the year does not start in January)
    const quarters = new Map<string, { start: string; end: string }>();
    for (const m of months) {
      const q = fiscalQuarterKey(`${m}-01`, fy);
      const cur = quarters.get(q);
      quarters.set(q, { start: cur?.start ?? `${m}-01`, end: monthEnd(m) });
    }
    for (const [q, r] of [...quarters.entries()].reverse()) {
      if (r.end > lastComplete || monthsBetween(r.start, r.end).length < 3) continue;
      out.push({ id: q, label: q.replace("-", " "), start: r.start, end: r.end });
    }
    const years = [...new Set(months.map((m) => fiscalYearOf(`${m}-01`, fy)))].reverse();
    for (const y of years) {
      const r = fiscalYearRange(y, fy);
      const start = r.start < model.minDate ? model.minDate : r.start;
      const partial = r.end > lastComplete;
      out.push({ id: `Y${y}`, label: `${fy === 1 ? y : `FY${y}`}${partial ? " to date" : ""}`, start, end: partial ? lastComplete : r.end });
    }
    out.push({ id: "all", label: "All data", start: model.minDate, end: model.maxDate });
    return out;
  }, [model, fy]);

  if (status !== "ready" || !model || !filters.start) return null;

  const current = presets.find((p) => p.start === filters.start && p.end === filters.end);
  const set = (patch: Partial<Filters>) => setFilters({ ...filters, ...patch });
  const active = filters.regions.length + filters.channels.length + filters.categories.length;

  return (
    <div className="flex flex-wrap items-center gap-2">
      <label className="sr-only" htmlFor="period">Period</label>
      <select
        id="period"
        className="h-9 rounded-md border border-line-strong bg-surface px-2.5 text-[0.82rem] font-medium text-ink"
        value={custom || !current ? "custom" : current.id}
        onChange={(e) => {
          if (e.target.value === "custom") return setCustom(true);
          setCustom(false);
          const p = presets.find((x) => x.id === e.target.value);
          if (p) set({ start: p.start, end: p.end });
        }}
      >
        {presets.map((p) => (
          <option key={p.id} value={p.id}>
            {p.label}
          </option>
        ))}
        <option value="custom">Custom dates…</option>
      </select>
      {(custom || !current) && (
        <div className="flex items-center gap-1.5 text-[0.82rem]">
          <input aria-label="Start date" type="date" min={model.minDate} max={filters.end} value={filters.start} onChange={(e) => e.target.value && set({ start: e.target.value })} className="h-9 rounded-md border border-line-strong bg-surface px-2" />
          <span className="text-muted">to</span>
          <input aria-label="End date" type="date" min={filters.start} max={model.maxDate} value={filters.end} onChange={(e) => e.target.value && set({ end: e.target.value })} className="h-9 rounded-md border border-line-strong bg-surface px-2" />
        </div>
      )}
      <MultiSelect label="Region" plural="regions" options={model.regions} selected={filters.regions} onChange={(regions) => set({ regions })} />
      <MultiSelect label="Channel" plural="channels" options={model.channels} selected={filters.channels} onChange={(channels) => set({ channels })} />
      <MultiSelect label="Category" plural="categories" options={model.categories} selected={filters.categories} onChange={(categories) => set({ categories })} />
      {active > 0 && (
        <button type="button" onClick={() => set({ regions: [], channels: [], categories: [], productIds: [] })} className="h-9 rounded-md px-2.5 text-[0.82rem] text-glaze hover:bg-glaze-soft">
          Clear filters
        </button>
      )}
      <span className="ml-auto hidden text-[0.78rem] text-muted xl:inline">Balances as of {formatDate(asOfDate(model, filters))}</span>
    </div>
  );
}
