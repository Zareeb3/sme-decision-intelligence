"use client";

import { useMemo, useState } from "react";
import { useReadyData } from "../DataProvider";
import { Notice, PageHeader, Panel } from "../ui";
import {
  collectionUpliftScenario,
  costDiscountScenario,
  HYPOTHETICAL_NOTICE,
  mixShiftScenario,
  targetChangeScenario,
  type ScenarioMetric,
  type ScenarioResult,
} from "@/lib/analytics/scenarios";
import { computeKpis } from "@/lib/analytics/kpis";
import { formatDays, formatPKR, formatPct } from "@/lib/analytics/format";

function fmt(v: number | null, unit: ScenarioMetric["unit"]) {
  if (v === null) return "—";
  return unit === "PKR" ? formatPKR(v) : unit === "days" ? formatDays(v) : unit === "pts" ? `${v.toFixed(1)} pts` : formatPct(v);
}

function fmtDiff(v: number | null, unit: ScenarioMetric["unit"]) {
  if (v === null) return "—";
  if (Math.abs(v) < 1e-9) return "no change";
  const sign = v > 0 ? "+" : "−";
  const a = Math.abs(v);
  return unit === "PKR" ? `${sign}${formatPKR(a)}` : unit === "days" ? `${sign}${Math.round(a)} days` : `${sign}${a.toFixed(1)} pts`;
}

function ScenarioTable({ r }: { r: ScenarioResult }) {
  return (
    <>
      <table className="w-full text-[0.85rem]">
        <thead>
          <tr className="border-b border-line text-left text-[0.75rem] text-muted">
            <th className="py-1.5 font-medium">Metric</th>
            <th className="py-1.5 text-right font-medium">Baseline</th>
            <th className="py-1.5 text-right font-medium">Scenario</th>
            <th className="py-1.5 text-right font-medium">Difference</th>
          </tr>
        </thead>
        <tbody>
          {r.metrics.map((m) => (
            <tr key={m.label} className="border-b border-line/70 last:border-0">
              <td className="py-1.5 pr-2">{m.label}</td>
              <td className="py-1.5 text-right tabular-nums text-muted">{fmt(m.baseline, m.unit)}</td>
              <td className="py-1.5 text-right font-medium tabular-nums">{fmt(m.scenario, m.unit)}</td>
              <td className="py-1.5 text-right tabular-nums">{fmtDiff(m.difference, m.unit === "%" ? "pts" : m.unit)}</td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3">
        <p className="text-[0.75rem] font-medium">Assumptions</p>
        <ul className="mt-1 list-disc space-y-0.5 pl-4 text-[0.78rem] text-muted">
          {r.assumptions.map((a) => <li key={a}>{a}</li>)}
          {r.caveats.filter((c) => c !== HYPOTHETICAL_NOTICE).map((c) => <li key={c}>{c}</li>)}
        </ul>
      </div>
    </>
  );
}

function Slider({ id, label, value, min, max, step, onChange, suffix }: { id: string; label: string; value: number; min: number; max: number; step: number; onChange: (v: number) => void; suffix: string }) {
  return (
    <div className="mb-4">
      <div className="flex items-baseline justify-between">
        <label htmlFor={id} className="text-[0.82rem] text-muted">{label}</label>
        <span className="text-[0.95rem] font-semibold tabular-nums">{value > 0 && min < 0 ? "+" : ""}{value}{suffix}</span>
      </div>
      <input id={id} type="range" min={min} max={max} step={step} value={value} onChange={(e) => onChange(Number(e.target.value))} className="mt-1 w-full accent-[var(--color-glaze)]" />
    </div>
  );
}

export function ScenariosView() {
  const ready = useReadyData();
  const [collectPct, setCollectPct] = useState(10);
  const [targetPct, setTargetPct] = useState(5);
  const [costPct, setCostPct] = useState(5);
  const [discPts, setDiscPts] = useState(0);
  const [mixDim, setMixDim] = useState<"product_category" | "channel">("product_category");
  const [mixFrom, setMixFrom] = useState("");
  const [mixTo, setMixTo] = useState("");
  const [mixPct, setMixPct] = useState(10);

  const k = useMemo(() => (ready ? computeKpis(ready.model, ready.filters) : null), [ready]);
  if (!ready || !k) return null;
  const { model, filters: f } = ready;
  const groups = mixDim === "channel" ? model.channels : model.categories;
  const from = groups.includes(mixFrom) ? mixFrom : groups[0];
  const to = groups.includes(mixTo) && mixTo !== from ? mixTo : groups.find((g) => g !== from) ?? groups[0];

  return (
    <>
      <PageHeader title="Scenarios" description="What-if calculations on the selected period. Each shows the baseline, your assumption, the result and the difference." />
      <Notice tone="watch">{HYPOTHETICAL_NOTICE} They show the arithmetic consequence of an assumption, not how likely the assumption is.</Notice>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Collect more of the overdue balance" subtitle="Extra collection applied to the overdue balance at the snapshot date.">
          <Slider id="collect" label="Additional share of overdue collected" value={collectPct} min={0} max={50} step={5} onChange={setCollectPct} suffix="%" />
          <ScenarioTable r={collectionUpliftScenario(model, f, collectPct, k)} />
        </Panel>

        <Panel title="Change the sales target" subtitle="How attainment and the gap would read under a different target.">
          <Slider id="target" label="Change to the sales target" value={targetPct} min={-20} max={30} step={1} onChange={setTargetPct} suffix="%" />
          <ScenarioTable r={targetChangeScenario(model, f, targetPct, k)} />
        </Panel>

        <Panel title="Change costs or discounts" subtitle="Volumes and list prices are held constant.">
          <Slider id="cost" label="Change in estimated unit cost" value={costPct} min={-10} max={20} step={1} onChange={setCostPct} suffix="%" />
          <Slider id="disc" label="Change in average discount" value={discPts} min={-5} max={10} step={0.5} onChange={setDiscPts} suffix=" pts" />
          <ScenarioTable r={costDiscountScenario(model, f, costPct, discPts)} />
        </Panel>

        <Panel title="Shift the sales mix" subtitle="Move part of one group's sales to another; each keeps its current margin.">
          <div className="mb-3 grid grid-cols-1 gap-2 sm:grid-cols-3">
            <label className="text-[0.78rem] text-muted">
              Mix by
              <select value={mixDim} onChange={(e) => setMixDim(e.target.value as "product_category" | "channel")} className="mt-1 block h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[0.85rem] text-ink">
                <option value="product_category">Product category</option>
                <option value="channel">Channel</option>
              </select>
            </label>
            <label className="text-[0.78rem] text-muted">
              From
              <select value={from} onChange={(e) => setMixFrom(e.target.value)} className="mt-1 block h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[0.85rem] text-ink">
                {groups.map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
            <label className="text-[0.78rem] text-muted">
              To
              <select value={to} onChange={(e) => setMixTo(e.target.value)} className="mt-1 block h-9 w-full rounded-md border border-line-strong bg-surface px-2 text-[0.85rem] text-ink">
                {groups.filter((g) => g !== from).map((g) => <option key={g}>{g}</option>)}
              </select>
            </label>
          </div>
          <Slider id="mix" label={`Share of ${from} sales moved`} value={mixPct} min={0} max={50} step={5} onChange={setMixPct} suffix="%" />
          <ScenarioTable r={mixShiftScenario(model, f, mixDim, from, to, mixPct)} />
        </Panel>
      </div>
    </>
  );
}
