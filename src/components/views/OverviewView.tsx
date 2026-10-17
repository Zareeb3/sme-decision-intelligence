"use client";

import Link from "next/link";
import { useMemo, useState } from "react";
import { useReadyData } from "../DataProvider";
import { Badge, DataTable, Delta, MetricCard, PageHeader, Panel } from "../ui";
import { SalesCollectionsChart } from "../charts";
import { computeKpis } from "@/lib/analytics/kpis";
import { monthlySeries } from "@/lib/analytics/trends";
import { attentionInsights, type Insight } from "@/lib/analytics/insights";
import { diagnoseSalesVsCollections } from "@/lib/analytics/diagnostics";
import { addMonths, monthKey, previousPeriod } from "@/lib/analytics/dates";
import { formatPKR, formatPct, formatPeriod, formatNumber } from "@/lib/analytics/format";

function InsightCard({ i }: { i: Insight }) {
  const tone = i.severity === "high" ? "risk" : i.severity === "medium" ? "watch" : "neutral";
  return (
    <article className="border-b border-line py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center gap-2">
        <Badge tone={tone}>{i.severity === "high" ? "High priority" : i.severity === "medium" ? "Watch" : "For awareness"}</Badge>
        <h3 className="text-[0.95rem] font-semibold text-ink">{i.title}</h3>
      </div>
      <dl className="mt-2.5 grid gap-x-6 gap-y-2 text-[0.85rem] leading-relaxed sm:grid-cols-[7.5rem_1fr]">
        <dt className="text-muted">What happened</dt>
        <dd>{i.what}</dd>
        <dt className="text-muted">Why it matters</dt>
        <dd>{i.why}</dd>
        <dt className="text-muted">Evidence</dt>
        <dd>
          <ul className="space-y-0.5">
            {i.evidence.map((e) => (
              <li key={e} className="tabular-nums">{e}</li>
            ))}
          </ul>
        </dd>
        <dt className="text-muted">Next step</dt>
        <dd>
          {i.next}{" "}
          <Link href={i.link} className="whitespace-nowrap font-medium text-glaze hover:underline">
            Open details
          </Link>
        </dd>
      </dl>
    </article>
  );
}

export function OverviewView() {
  const ready = useReadyData();
  const [showAll, setShowAll] = useState(false);
  const data = useMemo(() => {
    if (!ready) return null;
    const { model, filters: f } = ready;
    const k = computeKpis(model, f);
    const pp = previousPeriod(f.start, f.end);
    const prev = computeKpis(model, { ...f, ...pp });
    const trendStart = `${addMonths(monthKey(f.end), -11)}-01`;
    const trend = monthlySeries(model, { ...f, start: trendStart < model.minDate ? model.minDate : trendStart });
    const regions = diagnoseSalesVsCollections(model, f).regionRows;
    return { k, prev, pp, trend, insights: attentionInsights(model, f), regions };
  }, [ready]);
  if (!ready || !data) return null;
  const { k, prev, pp, trend, insights, regions } = data;
  const change = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);
  const vsPrev = <span className="text-faint"> vs {formatPeriod(pp.start, pp.end)}</span>;

  return (
    <>
      <PageHeader
        title="Overview"
        description={`${formatPeriod(k.period.start, k.period.end)}. Every figure is calculated from the loaded data; open the ? on any metric to see how.`}
      />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Net sales" metricId="netSales" value={formatPKR(k.netSales)} sub={<><Delta value={change(k.netSales, prev.netSales)} />{vsPrev}</>} />
        <MetricCard
          label="Sales target attainment"
          metricId="salesAttainmentPct"
          value={k.targetsAvailable ? formatPct(k.salesAttainmentPct) : "Not available"}
          tone={k.salesAttainmentPct === null ? undefined : k.salesAttainmentPct >= 100 ? "good" : "watch"}
          sub={k.targetsAvailable ? `Target ${formatPKR(k.salesTarget)}` : "Targets are set by region and month only"}
        />
        <MetricCard label="Estimated gross margin" metricId="estGrossMarginPct" value={formatPct(k.estGrossMarginPct)} sub={<>Gross profit {formatPKR(k.estGrossProfit)}</>} />
        <MetricCard
          label="Collections"
          metricId="collectionAttainmentPct"
          value={formatPKR(k.collections)}
          tone={k.collectionAttainmentPct === null ? undefined : k.collectionAttainmentPct >= 100 ? "good" : k.collectionAttainmentPct >= 90 ? "watch" : "risk"}
          sub={k.targetsAvailable ? <>{formatPct(k.collectionAttainmentPct)} of target</> : <><Delta value={change(k.collections, prev.collections)} />{vsPrev}</>}
        />
        <MetricCard label="Outstanding receivables" metricId="outstanding" value={formatPKR(k.outstanding)} sub={<>Simple DSO {k.dso90 === null ? "—" : `${Math.round(k.dso90)} days`}</>} />
        <MetricCard
          label="Overdue balance"
          metricId="overdue"
          value={formatPKR(k.overdue)}
          tone={(k.overduePct ?? 0) > 30 ? "risk" : (k.overduePct ?? 0) > 15 ? "watch" : "good"}
          sub={<>{formatPct(k.overduePct)} of outstanding; was {formatPKR(prev.overdue)}</>}
        />
        <MetricCard label="Invoice paid ratio" metricId="invoicePaidRatioPct" value={formatPct(k.invoicePaidRatioPct)} sub={`${formatNumber(k.invoicesRaised)} invoices raised in period`} />
        <MetricCard label="Open complaints" metricId="openComplaints" value={formatNumber(k.openComplaints)} sub={`${k.complaintsOpened} opened in period`} tone={k.openComplaints > 0 ? "watch" : "good"} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.35fr_1fr]">
        <Panel title="What needs attention" subtitle="Rule-based findings from the analytics engine. No AI is used here.">
          {insights.length ? (showAll ? insights : insights.slice(0, 4)).map((i) => <InsightCard key={i.id} i={i} />) : <p className="text-sm text-muted">No findings crossed the attention thresholds for this selection.</p>}
          {insights.length > 4 && (
            <button type="button" onClick={() => setShowAll((v) => !v)} className="mt-3 text-[0.85rem] font-medium text-glaze hover:underline">
              {showAll ? "Show fewer findings" : `Show ${insights.length - 4} more finding${insights.length - 4 > 1 ? "s" : ""}`}
            </button>
          )}
        </Panel>
        <div className="flex flex-col gap-6">
          <Panel title="Sales and collections, last 12 months" subtitle="Bars: net sales. Line: collections. Dashed: sales target.">
            <SalesCollectionsChart data={trend} />
          </Panel>
          <Panel title="Regions against target" subtitle="Selected period">
            <DataTable
              rows={regions}
              rowKey={(r) => r.region}
              columns={[
                { key: "r", header: "Region", render: (r) => <span className="font-medium">{r.region}</span> },
                { key: "s", header: "Net sales", align: "right", render: (r) => formatPKR(r.netSales) },
                { key: "sa", header: "Sales vs target", align: "right", render: (r) => formatPct(r.salesAttainmentPct) },
                {
                  key: "ca",
                  header: "Collections vs target",
                  align: "right",
                  render: (r) => <span className={r.collectionAttainmentPct !== null && r.collectionAttainmentPct < 90 ? "font-medium text-oxide" : ""}>{formatPct(r.collectionAttainmentPct)}</span>,
                },
              ]}
            />
          </Panel>
        </div>
      </div>
    </>
  );
}
