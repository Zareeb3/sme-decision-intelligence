"use client";

import { useMemo, useState } from "react";
import { useReadyData } from "../DataProvider";
import { Badge, DataTable, Delta, PageHeader, Panel, ShareBar } from "../ui";
import { ForecastChart, MarginChart, SalesCollectionsChart } from "../charts";
import { monthlySeries, quarterlySeries } from "@/lib/analytics/trends";
import { breakdown, type Dimension } from "@/lib/analytics/breakdowns";
import { productPerformance, productFlagRules } from "@/lib/analytics/products";
import { ANOMALY_THRESHOLD, detectSalesAnomalies } from "@/lib/analytics/anomalies";
import { backtestAndForecast, METHOD_LABELS } from "@/lib/analytics/forecast";
import { formatMonth, formatPKR, formatPct, formatPeriod } from "@/lib/analytics/format";

const DIMS: { id: Dimension; label: string }[] = [
  { id: "region", label: "Region" },
  { id: "channel", label: "Channel" },
  { id: "product_category", label: "Category" },
  { id: "customer_type", label: "Customer type" },
];

function Segmented<T extends string>({ value, options, onChange, label }: { value: T; options: { id: T; label: string }[]; onChange: (v: T) => void; label: string }) {
  return (
    <div role="radiogroup" aria-label={label} className="inline-flex rounded-md border border-line-strong bg-paper p-0.5 text-[0.8rem]">
      {options.map((o) => (
        <button
          key={o.id}
          type="button"
          role="radio"
          aria-checked={value === o.id}
          onClick={() => onChange(o.id)}
          className={`rounded px-2.5 py-1 ${value === o.id ? "bg-surface font-medium text-ink shadow-sm" : "text-muted hover:text-ink"}`}
        >
          {o.label}
        </button>
      ))}
    </div>
  );
}

export function SalesView() {
  const ready = useReadyData();
  const [grain, setGrain] = useState<"month" | "quarter">("month");
  const [dim, setDim] = useState<Dimension>("region");

  const data = useMemo(() => {
    if (!ready) return null;
    const { model, filters: f } = ready;
    const fc = backtestAndForecast(model, f);
    const fcData = fc.sufficient
      ? [
          ...fc.history.slice(-18).map((h) => ({ period: h.month, actual: h.actual, forecast: null, range: null as [number, number] | null })),
          ...fc.outlook.map((o) => ({ period: o.month, actual: null, forecast: o.forecast, range: [o.low, o.high] as [number, number] })),
        ]
      : [];
    return {
      monthly: monthlySeries(model, f),
      quarterly: quarterlySeries(model, f),
      products: productPerformance(model, f),
      anomalies: detectSalesAnomalies(model, f),
      fc,
      fcData,
    };
  }, [ready]);
  const rows = useMemo(() => (ready ? breakdown(ready.model, ready.filters, dim) : []), [ready, dim]);
  if (!ready || !data) return null;
  const series = grain === "month" ? data.monthly : data.quarterly;
  const PRODUCT_FLAG_RULES = productFlagRules(ready.settings.rules.products);
  const f = ready.filters;

  return (
    <>
      <PageHeader title="Sales & performance" description={`Where sales and estimated margin come from, ${formatPeriod(f.start, f.end)}, compared with the previous period of equal length.`} />

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-[1.6fr_1fr]">
        <Panel
          title="Net sales and collections"
          subtitle="Collections are counted by payment date; sales by order date."
          actions={<Segmented label="Time grain" value={grain} onChange={setGrain} options={[{ id: "month", label: "Monthly" }, { id: "quarter", label: "Quarterly" }]} />}
        >
          <SalesCollectionsChart data={series} />
        </Panel>
        <Panel title="Estimated gross margin" subtitle="Uses estimated standard costs, not audited costs.">
          <MarginChart data={series} />
        </Panel>
      </div>

      <Panel
        className="mt-6"
        title="Contribution by segment"
        subtitle="Change compares with the previous period. Contribution shows each segment's share of the total change in net sales."
        actions={<Segmented label="Segment" value={dim} onChange={setDim} options={DIMS} />}
      >
        <DataTable
          rows={rows}
          rowKey={(r) => r.key}
          columns={[
            { key: "l", header: "Segment", render: (r) => <span className="font-medium">{r.label}</span> },
            { key: "ns", header: "Net sales", align: "right", render: (r) => formatPKR(r.netSales) },
            { key: "sh", header: "Share", render: (r) => <div className="flex min-w-[7rem] items-center gap-2"><ShareBar pct={r.sharePct} /><span className="w-12 text-right tabular-nums text-muted">{formatPct(r.sharePct)}</span></div> },
            { key: "ch", header: "Change", align: "right", render: (r) => <Delta value={r.changePct} /> },
            { key: "ct", header: "Contribution to change", align: "right", render: (r) => <Delta value={r.contributionToChange * 100} digits={0} /> },
            { key: "m", header: "Est. margin", align: "right", render: (r) => formatPct(r.estGrossMarginPct) },
            { key: "d", header: "Avg discount", align: "right", render: (r) => formatPct(r.avgDiscountPct) },
          ]}
        />
      </Panel>

      <Panel
        className="mt-6"
        title="Products"
        subtitle={`Flags: sales down more than ${Math.abs(PRODUCT_FLAG_RULES.decliningPct)}%, margin more than ${PRODUCT_FLAG_RULES.weakMarginGapPts} pts below the portfolio (${formatPct(data.products.portfolioMarginPct)}), or margin down more than ${Math.abs(PRODUCT_FLAG_RULES.marginErosionPts)} pts.`}
      >
        <DataTable
          rows={data.products.rows}
          rowKey={(r) => r.key}
          maxRows={20}
          exportName={`products-${f.start}-${f.end}`}
          columns={[
            { key: "p", header: "Product", csv: (r) => r.label, render: (r) => <div><p className="font-medium">{r.label}</p><p className="text-[0.75rem] text-muted">{r.category}</p></div> },
            { key: "ns", header: "Net sales", align: "right", csv: (r) => Math.round(r.netSales), render: (r) => formatPKR(r.netSales) },
            { key: "ch", header: "Change", align: "right", csv: (r) => (r.changePct === null ? "" : r.changePct.toFixed(1)), render: (r) => <Delta value={r.changePct} /> },
            { key: "m", header: "Est. margin", csv: (r) => (r.estGrossMarginPct === null ? "" : r.estGrossMarginPct.toFixed(1)), align: "right", render: (r) => formatPct(r.estGrossMarginPct) },
            { key: "mc", header: "Margin change", align: "right", render: (r) => <Delta value={r.marginChangePts} suffix=" pts" /> },
            { key: "f", header: "Flags", csv: (r) => r.flags.join("; "), render: (r) => <div className="flex flex-wrap gap-1">{r.flags.map((x) => <Badge key={x} tone="watch">{x}</Badge>)}</div> },
          ]}
        />
      </Panel>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-2">
        <Panel title="Unusual months" subtitle={`Modified z-score against the previous 12 months; flagged above ${ANOMALY_THRESHOLD}. A flag says "unusual", not "why".`}>
          <DataTable
            rows={data.anomalies}
            rowKey={(a) => `${a.dimension}-${a.key}-${a.month}`}
            maxRows={10}
            empty="No product or region had a statistically unusual month in this period."
            columns={[
              { key: "l", header: "Product or region", render: (a) => <span className="font-medium">{a.label}</span> },
              { key: "m", header: "Month", render: (a) => formatMonth(a.month) },
              { key: "v", header: "Net sales", align: "right", render: (a) => formatPKR(a.value) },
              { key: "b", header: "Usual (median)", align: "right", render: (a) => formatPKR(a.baselineMedian) },
              { key: "z", header: "Score", align: "right", render: (a) => <Badge tone={a.direction === "above" ? "primary" : "risk"}>{a.z.toFixed(1)} {a.direction}</Badge> },
            ]}
          />
        </Panel>

        <Panel title="Baseline forecast" subtitle="Four simple methods compared on the last 6 months, each forecasting one month ahead.">
          {data.fc.sufficient ? (
            <>
              <ForecastChart data={data.fcData} />
              <table className="mt-4 w-full text-[0.82rem]">
                <thead>
                  <tr className="border-b border-line text-left text-[0.75rem] text-muted">
                    <th className="py-1.5 font-medium">Method</th>
                    <th className="py-1.5 text-right font-medium">Mean abs. % error</th>
                  </tr>
                </thead>
                <tbody>
                  {data.fc.scores.map((s) => (
                    <tr key={s.method} className="border-b border-line/70 last:border-0">
                      <td className="py-1.5">
                        {s.label} {s.method === data.fc.best && <Badge tone="primary">Lowest error</Badge>}
                      </td>
                      <td className="py-1.5 text-right tabular-nums">{formatPct(s.mapePct)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
              <ul className="mt-3 space-y-1 text-[0.78rem] text-muted">
                {data.fc.notes.map((n) => (
                  <li key={n}>{n}</li>
                ))}
              </ul>
              {data.fc.best && <p className="sr-only">Chosen method: {METHOD_LABELS[data.fc.best]}</p>}
            </>
          ) : (
            <p className="text-sm text-muted">{data.fc.reason}</p>
          )}
        </Panel>
      </div>
    </>
  );
}
