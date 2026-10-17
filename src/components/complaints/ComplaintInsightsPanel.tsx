"use client";

/**
 * Management view of complaints for the selected period and filters:
 * volume, categories that are increasing, where complaints concentrate,
 * repeat complainants, customers at elevated risk and recurring issues.
 */
import { useMemo } from "react";
import { Badge, DataTable, MetricCard, Notice, Panel, ShareBar } from "../ui";
import { CountBars } from "../charts";
import { complaintSummary, spikeRule } from "@/lib/analytics/complaints";
import { filterComplaints, type Filters } from "@/lib/analytics/filters";
import { addMonths, monthKey, monthsBetween } from "@/lib/analytics/dates";
import type { Model } from "@/lib/analytics/model";
import { formatDate, formatDays, formatMoney, formatNumber, formatSignedPct } from "@/lib/analytics/format";
import { complaintInsights } from "@/lib/complaints/insights";
import type { CompanySettings } from "@/lib/settings";
import { PriorityBadge } from "./shared";

export function ComplaintInsightsPanel({ model, filters: f, settings, onOpenCase }: { model: Model; filters: Filters; settings: CompanySettings; onOpenCase: (id: string) => void }) {
  const data = useMemo(() => {
    const s = complaintSummary(model, f);
    const ins = complaintInsights(model, f);
    const start = `${addMonths(monthKey(f.end), -11)}-01`;
    const months = monthsBetween(start, f.end);
    const rows = filterComplaints(model, { ...f, start, end: f.end });
    const monthly = months.map((m) => ({ period: m, count: rows.filter((c) => monthKey(c.date_opened) === m).length }));
    return { s, ins, monthly };
  }, [model, f]);
  const { s, ins, monthly } = data;
  const SPIKE = spikeRule(settings.rules.complaints);
  const maxRegion = Math.max(1, ...ins.byRegion.map((r) => r.count));
  const maxSeg = Math.max(1, ...ins.bySegment.map((r) => r.count));
  const rising = ins.categoryTrend.filter((t) => t.increasing);

  return (
    <>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Open complaints" metricId="openComplaints" value={formatNumber(s.openAtAsOf)} tone={s.openHighSeverity > 0 ? "risk" : s.openAtAsOf > 0 ? "watch" : "good"} sub={`${s.openHighSeverity} high or critical, as of ${formatDate(s.asOf)}`} />
        <MetricCard label="Opened in period" value={formatNumber(s.openedInPeriod)} />
        <MetricCard label="Average resolution time" value={formatDays(s.avgResolutionDays)} sub={s.resolvedInPeriod ? `${s.resolvedInPeriod} resolved in period` : "Needs opened and resolved dates"} />
        <MetricCard label="Claim value on open complaints" value={formatMoney(s.openClaimValue)} />
      </div>

      {(s.spikes.length > 0 || ins.recurringIssues.length > 0) && (
        <Panel className="mt-6" title="Recurring and rising product issues" subtitle={`Spike: at least ${SPIKE.minCount} complaints in ${SPIKE.windowDays} days and ${SPIKE.minRatio}× the product's normal rate. Recurring: at least ${settings.rules.complaints.systemicMinCount} complaints on the same product and category in ${settings.rules.complaints.systemicWindowDays} days.`}>
          <ul className="divide-y divide-line">
            {ins.recurringIssues.map((r) => {
              const sp = s.spikes.find((x) => x.product_id === r.product_id && x.topCategory === r.category);
              return (
                <li key={`${r.product_id}-${r.category}`} className="flex flex-wrap items-baseline justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                  <div>
                    <p className="font-medium">
                      {r.category} · {r.product} {sp && <Badge tone="risk">Unusual rise</Badge>}
                    </p>
                    <p className="text-[0.8rem] text-muted">From {r.customers} different customer(s). Worth a root-cause check (batch, process step, route); a pattern is not yet a proven cause.</p>
                  </div>
                  <p className="text-[0.85rem] tabular-nums">
                    <span className="font-semibold text-oxide">{r.count}</span> complaints · {r.open} open
                    {sp && <span className="text-muted"> · about {sp.baselinePerWindow.toFixed(1)} normally</span>}
                  </p>
                </li>
              );
            })}
          </ul>
        </Panel>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1.3fr_1fr]">
        <Panel title="Complaints opened per month" subtitle="Last 12 months up to the end of the selected period.">
          <CountBars data={monthly} label="Complaints opened" />
        </Panel>
        <Panel title="Categories: last 90 days vs the 90 days before" subtitle="Increasing: at least 3 recent, at least 2 more than before and 1.5× the earlier count.">
          {ins.categoryTrend.length === 0 ? (
            <p className="py-4 text-sm text-muted">No complaints in the last 180 days.</p>
          ) : (
            <table className="w-full text-[0.84rem]">
              <thead>
                <tr className="border-b border-line text-left text-[0.74rem] text-muted">
                  <th className="py-1.5 font-medium">Category</th>
                  <th className="py-1.5 text-right font-medium">Last 90 days</th>
                  <th className="py-1.5 text-right font-medium">90 days before</th>
                </tr>
              </thead>
              <tbody>
                {ins.categoryTrend.map((r) => (
                  <tr key={r.category} className="border-b border-line/70 last:border-0">
                    <td className="py-1.5">
                      <span className="flex flex-wrap items-center gap-1.5">
                        {r.category}
                        {r.increasing && <Badge tone="risk">Increasing</Badge>}
                      </span>
                    </td>
                    <td className="py-1.5 text-right font-medium tabular-nums">{r.recent}</td>
                    <td className="py-1.5 text-right tabular-nums text-muted">{r.previous}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          )}
          {rising.length === 0 && <p className="mt-2 text-[0.8rem] text-muted">No category meets the increase rule.</p>}
        </Panel>
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Where complaints come from" subtitle="Complaints opened in the period by customer region and segment.">
          <h3 className="mb-2 text-[0.8rem] font-medium text-muted">Region</h3>
          <ul className="space-y-2">
            {ins.byRegion.map((r) => (
              <li key={r.key} className="grid grid-cols-[7rem_1fr_6.5rem] items-center gap-3 text-[0.84rem]">
                <span className="truncate">{r.key}</span>
                <ShareBar pct={(r.count / maxRegion) * 100} />
                <span className="text-right tabular-nums">{r.count}<span className="text-faint"> · {r.open} open</span></span>
              </li>
            ))}
          </ul>
          <h3 className="mb-2 mt-5 text-[0.8rem] font-medium text-muted">Customer segment</h3>
          <ul className="space-y-2">
            {ins.bySegment.map((r) => (
              <li key={r.key} className="grid grid-cols-[7rem_1fr_6.5rem] items-center gap-3 text-[0.84rem]">
                <span className="truncate">{r.key}</span>
                <ShareBar pct={(r.count / maxSeg) * 100} />
                <span className="text-right tabular-nums">{r.count}<span className="text-faint"> · {r.open} open</span></span>
              </li>
            ))}
          </ul>
          {ins.byRegion.length === 0 && <p className="text-sm text-muted">No complaints in the period.</p>}
        </Panel>
        <Panel title="Open complaints by priority and age" subtitle={`As of ${formatDate(ins.asOf)}. Unreviewed imported complaints use their source severity.`}>
          <DataTable
            rows={ins.openByPriority}
            rowKey={(r) => r.priority}
            columns={[
              { key: "p", header: "Priority", render: (r) => <PriorityBadge priority={r.priority} /> },
              { key: "t", header: "Open", align: "right", render: (r) => <span className="font-semibold">{r.total}</span> },
              { key: "a", header: "≤7 days", align: "right", render: (r) => r.age["0-7"] },
              { key: "b", header: "8–30", align: "right", render: (r) => r.age["8-30"] },
              { key: "c", header: "31–60", align: "right", render: (r) => r.age["31-60"] },
              { key: "d", header: "60+", align: "right", render: (r) => <span className={r.age["60+"] ? "font-semibold text-oxide" : ""}>{r.age["60+"]}</span> },
            ]}
          />
        </Panel>
      </div>

      <Panel className="mt-6" title="Customers with elevated complaint risk" subtitle="Transparent points: 2 per open high/critical complaint (max 4), 2 for an escalation awaiting management, 1 for 3+ complaints in 180 days, 1 for sales down 10% or more. Shown from 3 points.">
        <DataTable
          rows={ins.riskCustomers}
          rowKey={(r) => r.customer_id}
          empty="No customer reaches 3 risk points."
          exportName="complaint-risk-customers"
          columns={[
            { key: "n", header: "Customer", render: (r) => <div><p className="font-medium">{r.name}</p><p className="text-[0.74rem] text-faint">{r.type} · {r.region}</p></div>, csv: (r) => r.name },
            { key: "s", header: "Points", align: "right", render: (r) => <span className="font-semibold">{r.score}</span>, csv: (r) => r.score },
            { key: "r", header: "Why", render: (r) => <span className="text-[0.8rem] text-muted">{r.reasons.join("; ")}</span>, csv: (r) => r.reasons.join("; ") },
            { key: "t", header: "Sales trend", align: "right", render: (r) => formatSignedPct(r.salesTrendPct), csv: (r) => r.salesTrendPct },
          ]}
        />
        <p className="mt-3 text-[0.78rem] text-muted">A falling sales trend next to complaints is an association to discuss with the account owner, not evidence that the complaints caused it.</p>
      </Panel>

      <div className="mt-6 grid grid-cols-1 gap-6 lg:grid-cols-2">
        <Panel title="Repeat complaints" subtitle={`Customers with ${settings.rules.complaints.repeatMinCount} or more complaints in the last 180 days.`}>
          <DataTable
            rows={ins.repeatCustomers}
            rowKey={(r) => r.customer_id}
            maxRows={8}
            empty="No repeat complainants."
            exportName="repeat-complaints"
            columns={[
              { key: "n", header: "Customer", render: (r) => r.name, csv: (r) => r.name },
              { key: "c", header: "Complaints", align: "right", render: (r) => r.count, csv: (r) => r.count },
              { key: "k", header: "Categories", render: (r) => <span className="text-[0.8rem] text-muted">{r.categories.join(", ")}</span>, csv: (r) => r.categories.join("; ") },
              { key: "o", header: "Open", align: "right", render: (r) => r.open, csv: (r) => r.open },
            ]}
          />
        </Panel>
        <Panel title="Complaints and sales: an association" subtitle={`Median change in sales (last 90 days vs the 90 before) for active customers with and without a complaint in the last 90 days.`}>
          {ins.salesAssociation.withComplaints.n >= 5 && ins.salesAssociation.without.n >= 5 ? (
            <dl className="grid grid-cols-2 gap-4">
              <div>
                <dt className="text-[0.78rem] text-muted">With a recent complaint</dt>
                <dd className="text-[1.4rem] font-semibold tabular-nums">{formatSignedPct(ins.salesAssociation.withComplaints.medianTrendPct)}</dd>
                <dd className="text-[0.75rem] text-faint">n = {ins.salesAssociation.withComplaints.n} customers</dd>
              </div>
              <div>
                <dt className="text-[0.78rem] text-muted">Without</dt>
                <dd className="text-[1.4rem] font-semibold tabular-nums">{formatSignedPct(ins.salesAssociation.without.medianTrendPct)}</dd>
                <dd className="text-[0.75rem] text-faint">n = {ins.salesAssociation.without.n} customers</dd>
              </div>
            </dl>
          ) : (
            <p className="text-sm text-muted">Too few active customers in one of the groups (fewer than 5) to compare.</p>
          )}
          <div className="mt-4">
            <Notice tone="neutral">This compares two groups; it does not show that complaints caused any change in sales. Customers who buy more also have more chances to complain, and seasonality, credit limits and projects all move sales.</Notice>
          </div>
        </Panel>
      </div>

      <Panel className="mt-6" title="Open complaints" subtitle="Highest priority first, then oldest. Open a complaint that has a case to review it.">
        <DataTable
          rows={s.openList}
          rowKey={(c) => c.complaint_id}
          empty="No open complaints at the snapshot date."
          maxRows={15}
          onRowClick={(c) => c.caseId && onOpenCase(c.caseId)}
          exportName="open-complaints"
          columns={[
            { key: "id", header: "Complaint", render: (c) => <div><p className="font-medium">{c.caseId ?? c.complaint_id}</p><p className="text-[0.72rem] text-faint">Opened {formatDate(c.date_opened)}{c.origin === "register" ? " · entered in the app" : ""}</p></div>, csv: (c) => c.caseId ?? c.complaint_id },
            { key: "p", header: "Priority", render: (c) => <PriorityBadge priority={c.origin === "register" ? c.priority : (c.priority ?? c.severity)} confirmed={c.origin === "import" && !c.caseId ? true : Boolean(c.priorityConfirmed)} />, csv: (c) => c.priority ?? c.severity },
            { key: "c", header: "Issue", render: (c) => <div><p>{c.category}</p><p className="text-[0.72rem] text-faint">{c.product_name}</p></div>, csv: (c) => c.category },
            { key: "t", header: "Team", render: (c) => c.assigned_team, csv: (c) => c.assigned_team },
            { key: "a", header: "Age", align: "right", render: (c) => `${c.ageDays} days`, csv: (c) => c.ageDays },
            { key: "v", header: "Claim", align: "right", render: (c) => formatMoney(c.claim_value_pkr), csv: (c) => c.claim_value_pkr },
          ]}
        />
      </Panel>
    </>
  );
}
