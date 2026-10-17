"use client";

/**
 * One-page management report for the selected period, designed to print or
 * save as PDF from the browser (A4 portrait).
 */
import { useMemo } from "react";
import { useData, useReadyData } from "../DataProvider";
import { Button } from "../ui";
import { computeKpis } from "@/lib/analytics/kpis";
import { attentionInsights } from "@/lib/analytics/insights";
import { diagnoseSalesVsCollections } from "@/lib/analytics/diagnostics";
import { receivablesByCustomer } from "@/lib/analytics/receivables";
import { productPerformance } from "@/lib/analytics/products";
import { previousPeriod } from "@/lib/analytics/dates";
import { describeFilters } from "@/lib/analytics/filters";
import { formatDate, formatDays, formatPKR, formatPct, formatPeriod, formatSignedPct } from "@/lib/analytics/format";

function Kpi({ label, value, sub }: { label: string; value: string; sub?: string }) {
  return (
    <div className="border-l-2 border-glaze/60 pl-3">
      <p className="text-[0.72rem] text-muted">{label}</p>
      <p className="text-[1.15rem] font-semibold tabular-nums">{value}</p>
      {sub && <p className="text-[0.7rem] text-faint">{sub}</p>}
    </div>
  );
}

export function ReportView() {
  const ready = useReadyData();
  const { origin } = useData();
  const data = useMemo(() => {
    if (!ready) return null;
    const { model, filters: f } = ready;
    const k = computeKpis(model, f);
    const prev = computeKpis(model, { ...f, ...previousPeriod(f.start, f.end) });
    return {
      k,
      prev,
      insights: attentionInsights(model, f).slice(0, 5),
      regions: diagnoseSalesVsCollections(model, f).regionRows,
      overdue: receivablesByCustomer(model, f).slice(0, 8),
      products: productPerformance(model, f).rows.filter((r) => r.flags.length).slice(0, 6),
    };
  }, [ready]);
  if (!ready || !data) return null;
  const { k, prev, insights, regions, overdue, products } = data;
  const change = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);

  return (
    <>
      <div className="mb-5 flex flex-wrap items-center justify-between gap-3 print:hidden">
        <p className="text-[0.88rem] text-muted">A one-page summary for management meetings. Use Print and choose &ldquo;Save as PDF&rdquo; to share it.</p>
        <Button onClick={() => window.print()}>Print or save as PDF</Button>
      </div>

      <article className="mx-auto max-w-[210mm] rounded-lg border border-line bg-surface p-8 text-[0.85rem] print:max-w-none print:rounded-none print:border-0 print:p-0">
        <header className="flex flex-wrap items-end justify-between gap-2 border-b-2 border-ink pb-3">
          <div>
            <p className="text-[0.75rem] text-muted">Management report</p>
            <h1 className="text-[1.5rem] font-semibold leading-tight">{ready.settings.companyName}</h1>
          </div>
          <div className="text-right text-[0.75rem] text-muted">
            <p className="font-medium text-ink">{formatPeriod(k.period.start, k.period.end)}</p>
            <p>Balances as of {formatDate(k.period.asOf)}</p>
            <p>{describeFilters(ready.filters).split("; ").slice(1).join("; ") || "All regions, channels and products"}</p>
          </div>
        </header>

        <section className="mt-5 grid grid-cols-2 gap-x-4 gap-y-4 sm:grid-cols-4">
          <Kpi label="Net sales" value={formatPKR(k.netSales)} sub={`${formatSignedPct(change(k.netSales, prev.netSales))} vs previous period`} />
          <Kpi label="Sales vs target" value={k.targetsAvailable ? formatPct(k.salesAttainmentPct) : "—"} sub={k.salesTarget ? `Target ${formatPKR(k.salesTarget)}` : undefined} />
          <Kpi label="Collections" value={formatPKR(k.collections)} sub={k.collectionTarget ? `${formatPct(k.collectionAttainmentPct)} of target` : undefined} />
          <Kpi label="Est. gross margin" value={formatPct(k.estGrossMarginPct)} sub={`Gross profit ${formatPKR(k.estGrossProfit)}`} />
          <Kpi label="Outstanding" value={formatPKR(k.outstanding)} sub={`DSO ${formatDays(k.dso90)}`} />
          <Kpi label="Overdue" value={formatPKR(k.overdue)} sub={`${formatPct(k.overduePct)} of outstanding`} />
          <Kpi label="Over 90 days" value={formatPKR(k.over90)} />
          <Kpi label="Open complaints" value={String(k.openComplaints)} sub={`${k.complaintsOpened} opened in period`} />
        </section>

        <section className="mt-6 break-inside-avoid">
          <h2 className="border-b border-line pb-1 text-[0.95rem] font-semibold">What needs attention</h2>
          <ol className="mt-2 space-y-2.5">
            {insights.map((i) => (
              <li key={i.id} className="break-inside-avoid">
                <p className="font-medium">
                  {i.title} <span className="text-[0.72rem] font-normal text-muted">({i.severity === "high" ? "high priority" : i.severity === "medium" ? "watch" : "for awareness"})</span>
                </p>
                <p className="text-muted">{i.what} {i.why}</p>
                <p><span className="text-muted">Next step:</span> {i.next}</p>
              </li>
            ))}
            {insights.length === 0 && <li className="text-muted">No findings crossed the attention thresholds.</li>}
          </ol>
        </section>

        <div className="mt-6 grid gap-6 sm:grid-cols-2">
          <section className="break-inside-avoid">
            <h2 className="border-b border-line pb-1 text-[0.95rem] font-semibold">Regions against target</h2>
            <table className="mt-2 w-full text-[0.78rem]">
              <thead className="text-left text-muted">
                <tr>
                  <th className="py-1 font-medium">Region</th>
                  <th className="py-1 text-right font-medium">Sales</th>
                  <th className="py-1 text-right font-medium">vs target</th>
                  <th className="py-1 text-right font-medium">Collections vs target</th>
                </tr>
              </thead>
              <tbody>
                {regions.map((r) => (
                  <tr key={r.region} className="border-t border-line/70">
                    <td className="py-1">{r.region}</td>
                    <td className="py-1 text-right tabular-nums">{formatPKR(r.netSales)}</td>
                    <td className="py-1 text-right tabular-nums">{formatPct(r.salesAttainmentPct)}</td>
                    <td className="py-1 text-right tabular-nums">{formatPct(r.collectionAttainmentPct)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
          <section className="break-inside-avoid">
            <h2 className="border-b border-line pb-1 text-[0.95rem] font-semibold">Largest overdue balances</h2>
            <table className="mt-2 w-full text-[0.78rem]">
              <tbody>
                {overdue.filter((r) => r.overdue > 0).map((r) => (
                  <tr key={r.customer_id} className="border-t border-line/70 first:border-0">
                    <td className="py-1">{r.customer_name}</td>
                    <td className="py-1 text-right tabular-nums">{formatPKR(r.overdue)}</td>
                    <td className="py-1 text-right text-muted tabular-nums">{r.oldestDaysPastDue}d</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </section>
        </div>

        {products.length > 0 && (
          <section className="mt-6 break-inside-avoid">
            <h2 className="border-b border-line pb-1 text-[0.95rem] font-semibold">Products to review</h2>
            <ul className="mt-2 space-y-1 text-[0.78rem]">
              {products.map((p) => (
                <li key={p.key}>
                  <span className="font-medium">{p.label}</span> <span className="text-muted">({formatPKR(p.netSales)}, margin {formatPct(p.estGrossMarginPct)}): {p.flags.join("; ")}</span>
                </li>
              ))}
            </ul>
          </section>
        )}

        <footer className="mt-8 border-t border-line pt-2 text-[0.7rem] text-faint">
          Generated {formatDate(new Date().toISOString().slice(0, 10))} by Decision Intelligence from {origin === "sample" ? "fictional sample data" : "validated company data"}. Amounts in {ready.settings.currency}. Gross profit uses estimated costs. Findings are rule-based; definitions are available in the app.
        </footer>
      </article>
    </>
  );
}
