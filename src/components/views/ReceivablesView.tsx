"use client";

import { useMemo } from "react";
import { useReadyData } from "../DataProvider";
import { DataTable, MetricCard, PageHeader, Panel, ShareBar } from "../ui";
import { AgingChart } from "../charts";
import { computeKpis } from "@/lib/analytics/kpis";
import { overdueByRegion, receivablesByCustomer } from "@/lib/analytics/receivables";
import { diagnoseSalesVsCollections } from "@/lib/analytics/diagnostics";
import { formatDate, formatDays, formatNumber, formatPKR, formatPct } from "@/lib/analytics/format";
import { receivablesSnapshot } from "@/lib/analytics/receivables";

export function ReceivablesView() {
  const ready = useReadyData();
  const data = useMemo(() => {
    if (!ready) return null;
    const { model, filters: f } = ready;
    const d = diagnoseSalesVsCollections(model, f);
    return {
      k: computeKpis(model, f),
      snap: receivablesSnapshot(model, f),
      regions: overdueByRegion(model, f),
      customers: receivablesByCustomer(model, f),
      d,
    };
  }, [ready]);
  if (!ready || !data) return null;
  const { k, snap, regions, customers, d } = data;
  const maxRegion = Math.max(1, ...regions.map((r) => r.overdue));

  return (
    <>
      <PageHeader
        title="Receivables"
        description={`Balances as of ${formatDate(snap.asOf)} (the end of the selected period). Older unpaid invoices are included; payments made after this date are treated as not yet received.`}
      />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Outstanding" metricId="outstanding" value={formatPKR(snap.outstanding)} sub={`${formatNumber(snap.openInvoiceCount)} open invoices`} />
        <MetricCard label="Overdue" metricId="overdue" value={formatPKR(snap.overdue)} tone={(snap.overduePct ?? 0) > 30 ? "risk" : "watch"} sub={`${formatPct(snap.overduePct)} of outstanding`} />
        <MetricCard label="More than 90 days past due" value={formatPKR(snap.over90)} tone={snap.over90 > 0 ? "risk" : "good"} sub="Least likely to be recovered without action" />
        <MetricCard label="Simple DSO" metricId="dso90" value={formatDays(k.dso90)} sub={`Collections in period ${formatPKR(k.collections)}`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Aging of outstanding balances" subtitle="Days past the invoice due date.">
          <AgingChart data={snap.aging} />
          <table className="mt-3 w-full text-[0.8rem]">
            <tbody>
              {snap.aging.map((a) => (
                <tr key={a.bucket} className="border-b border-line/70 last:border-0">
                  <td className="py-1">{a.bucket}</td>
                  <td className="py-1 text-right tabular-nums">{formatPKR(a.amount)}</td>
                  <td className="py-1 text-right tabular-nums text-muted">{a.invoices} invoices</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Panel>
        <Panel title="Overdue by region">
          <ul className="space-y-3">
            {regions.map((r) => (
              <li key={r.region}>
                <div className="flex justify-between text-[0.85rem]">
                  <span className="font-medium">{r.region}</span>
                  <span className="tabular-nums text-muted">{formatPKR(r.overdue)} of {formatPKR(r.outstanding)}</span>
                </div>
                <div className="mt-1"><ShareBar tone="risk" pct={(r.overdue / maxRegion) * 100} /></div>
              </li>
            ))}
          </ul>
          <h3 className="mt-6 text-[0.85rem] font-semibold">Largest increases in overdue</h3>
          <p className="text-[0.75rem] text-muted">From {formatDate(d.previous.period.asOf)} to {formatDate(d.current.period.asOf)}</p>
          <ul className="mt-2 space-y-1.5 text-[0.82rem]">
            {d.overdueMovers.filter((m) => m.change > 0).slice(0, 5).map((m) => (
              <li key={m.customer_id} className="flex justify-between gap-3">
                <span className="truncate">{m.customer_name} <span className="text-faint">({m.region})</span></span>
                <span className="shrink-0 tabular-nums">{formatPKR(m.overduePrev)} → <span className="font-medium text-oxide">{formatPKR(m.overdueNow)}</span></span>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      <Panel className="mt-6" title="Accounts with open balances" subtitle="Sorted by overdue amount.">
        <DataTable
          rows={customers}
          rowKey={(r) => r.customer_id}
          maxRows={30}
          exportName={`open-balances-${snap.asOf}`}
          columns={[
            { key: "n", header: "Customer", csv: (r) => r.customer_name, render: (r) => <div><p className="font-medium">{r.customer_name}</p><p className="text-[0.72rem] text-faint">{r.customer_type}, {r.region} · {r.payment_terms_days}-day terms</p></div> },
            { key: "id", header: "Customer ID", csv: (r) => r.customer_id, render: () => null, exportOnly: true },
            { key: "o", header: "Outstanding", align: "right", csv: (r) => Math.round(r.outstanding), render: (r) => formatPKR(r.outstanding) },
            { key: "d", header: "Overdue", align: "right", csv: (r) => Math.round(r.overdue), render: (r) => <span className={r.overdue > 0 ? "font-medium" : "text-faint"}>{formatPKR(r.overdue)}</span> },
            { key: "9", header: "90+ days", align: "right", csv: (r) => Math.round(r.over90), render: (r) => <span className={r.over90 > 0 ? "text-oxide" : "text-faint"}>{formatPKR(r.over90)}</span> },
            { key: "a", header: "Oldest overdue", align: "right", csv: (r) => r.oldestDaysPastDue, render: (r) => (r.oldestDaysPastDue ? `${r.oldestDaysPastDue} days` : "—") },
            { key: "c", header: "Credit used", align: "right", csv: (r) => (r.creditUtilizationPct === null ? "" : Math.round(r.creditUtilizationPct)), render: (r) => <span className={(r.creditUtilizationPct ?? 0) > 100 ? "font-medium text-oxide" : ""}>{formatPct(r.creditUtilizationPct, 0)}</span> },
          ]}
        />
      </Panel>
    </>
  );
}
