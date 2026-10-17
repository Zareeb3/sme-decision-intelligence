"use client";

import { useMemo } from "react";
import { useReadyData } from "../DataProvider";
import { Badge, DataTable, MetricCard, PageHeader, Panel } from "../ui";
import { CountBars } from "../charts";
import { complaintSummary, spikeRule } from "@/lib/analytics/complaints";
import { filterComplaints } from "@/lib/analytics/filters";
import { addMonths, monthKey, monthsBetween } from "@/lib/analytics/dates";
import { formatDate, formatDays, formatNumber, formatPKR } from "@/lib/analytics/format";

export function ComplaintsView() {
  const ready = useReadyData();
  const data = useMemo(() => {
    if (!ready) return null;
    const { model, filters: f } = ready;
    const s = complaintSummary(model, f);
    const start = `${addMonths(monthKey(f.end), -11)}-01`;
    const months = monthsBetween(start, f.end);
    const rows = filterComplaints(model, { ...f, start, end: f.end });
    const monthly = months.map((m) => ({ period: m, count: rows.filter((c) => monthKey(c.date_opened) === m).length }));
    return { s, monthly };
  }, [ready]);
  if (!ready || !data) return null;
  const { s, monthly } = data;
  const SPIKE_RULE = spikeRule(ready.settings.rules.complaints);

  return (
    <>
      <PageHeader title="Complaints" description={`Open complaints as of ${formatDate(s.asOf)}, who owns them, and products with an unusual rise in complaints.`} />
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Open complaints" metricId="openComplaints" value={formatNumber(s.openAtAsOf)} tone={s.openHighSeverity > 0 ? "risk" : s.openAtAsOf > 0 ? "watch" : "good"} sub={`${s.openHighSeverity} high severity`} />
        <MetricCard label="Opened in period" value={formatNumber(s.openedInPeriod)} />
        <MetricCard label="Average resolution time" value={formatDays(s.avgResolutionDays)} sub={`${s.resolvedInPeriod} resolved in period`} />
        <MetricCard label="Claim value on open complaints" value={formatPKR(s.openClaimValue)} />
      </div>

      {s.spikes.length > 0 && (
        <Panel className="mt-6" title="Unusual rise in complaints" subtitle={`Flagged when a product has at least ${SPIKE_RULE.minCount} complaints in the last ${SPIKE_RULE.windowDays} days and at least ${SPIKE_RULE.minRatio}× its normal rate over the prior 12 months.`}>
          <ul className="divide-y divide-line">
            {s.spikes.map((sp) => (
              <li key={sp.product_id} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div>
                  <p className="font-medium">{sp.product_name}</p>
                  <p className="text-[0.82rem] text-muted">Mostly {sp.topCategory.toLowerCase()}. Suggested next step: match complaint orders to production batches.</p>
                </div>
                <p className="text-[0.85rem] tabular-nums">
                  <span className="font-semibold text-oxide">{sp.recentCount}</span> in {sp.recentDays} days vs about {sp.baselinePerWindow.toFixed(1)} normally
                </p>
              </li>
            ))}
          </ul>
        </Panel>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Complaints opened per month" subtitle="Last 12 months up to the end of the selected period.">
          <CountBars data={monthly} label="Complaints opened" />
        </Panel>
        <Panel title="By owning team">
          <DataTable
            rows={s.byTeam}
            rowKey={(r) => r.key}
            columns={[
              { key: "t", header: "Team", render: (r) => <span className="font-medium">{r.key}</span> },
              { key: "o", header: "Open", align: "right", render: (r) => r.open },
              { key: "p", header: "Opened in period", align: "right", render: (r) => r.opened },
              { key: "a", header: "Avg age of open", align: "right", render: (r) => formatDays(r.avgOpenAgeDays) },
            ]}
          />
          <h3 className="mb-1 mt-5 text-[0.85rem] font-semibold">By category</h3>
          <DataTable
            rows={s.byCategory}
            rowKey={(r) => r.key}
            columns={[
              { key: "c", header: "Category", render: (r) => r.key },
              { key: "o", header: "Open", align: "right", render: (r) => r.open },
              { key: "p", header: "Opened in period", align: "right", render: (r) => r.opened },
            ]}
          />
        </Panel>
      </div>

      <Panel className="mt-6" title="Open complaints" subtitle="High severity first, then oldest.">
        <DataTable
          rows={s.openList}
          rowKey={(c) => c.complaint_id}
          empty="No open complaints at the snapshot date."
          columns={[
            { key: "id", header: "Complaint", render: (c) => <div><p className="font-medium">{c.complaint_id}</p><p className="text-[0.72rem] text-faint">Opened {formatDate(c.date_opened)}</p></div> },
            { key: "s", header: "Severity", render: (c) => <Badge tone={c.severity === "High" ? "risk" : c.severity === "Medium" ? "watch" : "neutral"}>{c.severity}</Badge> },
            { key: "c", header: "Issue", render: (c) => <div><p>{c.category}</p><p className="text-[0.72rem] text-faint">{c.product_name}</p></div> },
            { key: "t", header: "Team", render: (c) => c.assigned_team },
            { key: "a", header: "Age", align: "right", render: (c) => `${c.ageDays} days` },
            { key: "v", header: "Claim", align: "right", render: (c) => formatPKR(c.claim_value_pkr) },
          ]}
        />
      </Panel>
    </>
  );
}
