"use client";

import { useMemo, useState } from "react";
import { useReadyData } from "../DataProvider";
import { Badge, bandTone, DataTable, Delta, MetricCard, PageHeader, Panel, ShareBar } from "../ui";
import { ParetoChart } from "../charts";
import { customerConcentration } from "@/lib/analytics/concentration";
import { customerProfiles, healthRuleDescriptions, type CustomerProfile } from "@/lib/analytics/customers";
import { formatDate, formatNumber, formatPKR, formatPct } from "@/lib/analytics/format";

const BANDS = ["Healthy", "Watch", "Needs attention", "Insufficient data"] as const;

function CustomerDetail({ p, onClose }: { p: CustomerProfile; onClose: () => void }) {
  return (
    <Panel
      title={p.customer_name}
      subtitle={`${p.customer_type} in ${p.city}, ${p.region}. ${p.account_status} account. Terms ${p.payment_terms_days} days.`}
      actions={<button type="button" onClick={onClose} className="rounded px-2 py-1 text-sm text-glaze hover:bg-glaze-soft">Close</button>}
    >
      <div className="flex flex-wrap items-baseline gap-3">
        <p className="text-[2rem] font-semibold leading-none">{p.healthScore ?? "—"}</p>
        <p className="text-sm text-muted">/ 100</p>
        <Badge tone={bandTone(p.healthBand)}>{p.healthBand}</Badge>
      </div>
      <p className="mt-2 text-[0.8rem] text-muted">Rule-based indicator for prioritising follow-up. It is not a validated prediction of default or churn.</p>

      <h3 className="mt-5 text-[0.85rem] font-semibold">Why this score</h3>
      {p.deductions.length ? (
        <ul className="mt-2 space-y-2">
          {p.deductions.map((d) => (
            <li key={d.rule} className="flex gap-3 text-[0.85rem]">
              <span className="w-10 shrink-0 text-right font-medium tabular-nums text-oxide">−{d.points}</span>
              <span><span className="font-medium">{d.rule}.</span> {d.evidence}</span>
            </li>
          ))}
        </ul>
      ) : (
        <p className="mt-2 text-[0.85rem] text-muted">{p.healthScore === null ? "Too little recent history to score this account." : "No rule deductions. All indicators are within thresholds."}</p>
      )}

      <dl className="mt-5 grid grid-cols-2 gap-x-4 gap-y-3 text-[0.82rem] sm:grid-cols-3">
        {[
          ["Net sales in period", formatPKR(p.periodNetSales)],
          ["Last 90 days", formatPKR(p.sales90)],
          ["Previous 90 days", formatPKR(p.salesPrev90)],
          ["Last order", p.lastOrderDate ? `${formatDate(p.lastOrderDate)} (${p.recencyDays} days ago)` : "—"],
          ["Usual gap between orders", p.usualOrderGapDays === null ? "—" : `${Math.round(p.usualOrderGapDays)} days`],
          ["Orders, last 6 months", formatNumber(p.ordersLast180)],
          ["Outstanding", formatPKR(p.outstanding)],
          ["Overdue", `${formatPKR(p.overdue)} (${formatPct(p.overdueSharePct, 0)})`],
          ["Credit limit used", formatPct(p.creditUtilizationPct, 0)],
        ].map(([k, v]) => (
          <div key={k}>
            <dt className="text-muted">{k}</dt>
            <dd className="font-medium tabular-nums">{v}</dd>
          </div>
        ))}
      </dl>
    </Panel>
  );
}

export function CustomersView() {
  const ready = useReadyData();
  const [typeChoice, setType] = useState<string | null>(null);
  const [band, setBand] = useState<string>("All");
  const [q, setQ] = useState("");
  const [selected, setSelected] = useState<string | null>(null);

  const data = useMemo(() => {
    if (!ready) return null;
    const conc = customerConcentration(ready.model, ready.filters);
    return { conc, profiles: customerProfiles(ready.model, ready.filters) };
  }, [ready]);
  if (!ready || !data) return null;
  const { conc, profiles } = data;
  const types = [...new Set(profiles.map((p) => p.customer_type))].sort();
  const partner = ready.settings.partnerType;
  const type = typeChoice ?? (types.some((t) => t.toLowerCase() === partner.toLowerCase()) ? types.find((t) => t.toLowerCase() === partner.toLowerCase())! : "All");

  const scoped = profiles.filter((p) => type === "All" || p.customer_type === type);
  const shown = scoped
    .filter((p) => band === "All" || p.healthBand === band)
    .filter((p) => !q || p.customer_name.toLowerCase().includes(q.toLowerCase()) || p.customer_id.toLowerCase().includes(q.toLowerCase()))
    .sort((a, b) => (a.healthScore ?? 101) - (b.healthScore ?? 101) || b.periodNetSales - a.periodNetSales);
  const sel = profiles.find((p) => p.customer_id === selected);
  const hhiReading = conc.hhi < 1500 ? "unconcentrated" : conc.hhi < 2500 ? "moderately concentrated" : "highly concentrated";

  return (
    <>
      <PageHeader title="Customers & partners" description="Who the business depends on, and which accounts need a conversation. Customer filters use each account's own region and channel." />

      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 xl:grid-cols-4">
        <MetricCard label="Largest customer" metricId="topCustomerShare" value={formatPct(conc.top1SharePct)} sub={conc.ranked[0]?.customer_name ?? "—"} />
        <MetricCard label="Top 5 customers" metricId="topCustomerShare" value={formatPct(conc.top5SharePct)} sub={`Top 10: ${formatPct(conc.top10SharePct)}`} />
        <MetricCard label="Customers making up 80% of sales" value={`${conc.customersFor80Pct} of ${conc.customers}`} />
        <MetricCard label="HHI concentration index" metricId="topCustomerShare" value={formatNumber(conc.hhi)} sub={`Reads as ${hhiReading} (under 1,500 = unconcentrated)`} />
      </div>

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1fr]">
        <Panel title="Cumulative share of net sales" subtitle="How quickly sales accumulate as you add customers from largest to smallest.">
          <ParetoChart data={conc.ranked.map((r, i) => ({ rank: i + 1, cumulativePct: r.cumulativePct, name: r.customer_name }))} />
        </Panel>
        <Panel title="Largest customers in the period">
          <ul className="space-y-2.5">
            {conc.ranked.slice(0, 8).map((r) => (
              <li key={r.customer_id}>
                <button type="button" className="w-full text-left" onClick={() => setSelected(r.customer_id)}>
                  <div className="flex items-baseline justify-between gap-3 text-[0.85rem]">
                    <span className="truncate font-medium hover:text-glaze">{r.customer_name}</span>
                    <span className="shrink-0 tabular-nums text-muted">{formatPKR(r.netSales)} · {formatPct(r.sharePct)}</span>
                  </div>
                  <p className="text-[0.72rem] text-faint">{r.customer_type}, {r.region}</p>
                  <div className="mt-1"><ShareBar pct={(r.sharePct / (conc.ranked[0]?.sharePct || 1)) * 100} /></div>
                </button>
              </li>
            ))}
          </ul>
        </Panel>
      </div>

      {sel && (
        <div className="mt-6">
          <CustomerDetail p={sel} onClose={() => setSelected(null)} />
        </div>
      )}

      <Panel
        className="mt-6"
        title="Account health"
        subtitle="Transparent business rules, lowest scores first. Select an account to see the evidence behind its score."
        actions={
          <details className="relative">
            <summary className="rounded-md border border-line-strong px-3 py-1.5 text-[0.8rem] text-ink hover:border-glaze">How the score works</summary>
            <div className="absolute right-0 top-10 z-30 w-[22rem] rounded-md border border-line-strong bg-surface p-3.5 text-[0.8rem] shadow-lg">
              <p className="text-muted">Each account starts at 100. Points are deducted when a rule is triggered. Thresholds are set in Settings and should be agreed with the sales and finance teams.</p>
              <ul className="mt-2 space-y-1.5">
                {healthRuleDescriptions(ready.settings.rules.health).map((r) => (
                  <li key={r.rule}><span className="font-medium">{r.rule}.</span> <span className="text-muted">{r.detail}</span></li>
                ))}
              </ul>
            </div>
          </details>
        }
      >
        <div className="mb-4 flex flex-wrap items-center gap-2">
          <select aria-label="Customer type" value={type} onChange={(e) => setType(e.target.value)} className="h-9 rounded-md border border-line-strong bg-surface px-2.5 text-[0.82rem]">
            {["All", ...types].map((t) => <option key={t} value={t}>{t === "All" ? "All customer types" : t}</option>)}
          </select>
          <div className="flex flex-wrap gap-1.5">
            {["All", ...BANDS].map((b) => {
              const n = b === "All" ? scoped.length : scoped.filter((p) => p.healthBand === b).length;
              return (
                <button key={b} type="button" onClick={() => setBand(b)} aria-pressed={band === b} className={`rounded-md border px-2.5 py-1.5 text-[0.8rem] ${band === b ? "border-glaze bg-glaze-soft text-glaze-deep" : "border-line text-muted hover:text-ink"}`}>
                  {b} <span className="tabular-nums">({n})</span>
                </button>
              );
            })}
          </div>
          <input type="search" placeholder="Search name or ID" value={q} onChange={(e) => setQ(e.target.value)} className="ml-auto h-9 w-full rounded-md border border-line-strong bg-surface px-3 text-[0.85rem] sm:w-56" />
        </div>
        <DataTable
          rows={shown}
          rowKey={(p) => p.customer_id}
          onRowClick={(p) => setSelected(p.customer_id)}
          maxRows={40}
          exportName={`account-health-${ready.filters.end}`}
          columns={[
            { key: "id", header: "Customer ID", csv: (p) => p.customer_id, render: () => null, exportOnly: true },
            { key: "ty", header: "Type", csv: (p) => p.customer_type, render: () => null, exportOnly: true },
            { key: "rg", header: "Region", csv: (p) => p.region, render: () => null, exportOnly: true },
            { key: "why", header: "Reasons", csv: (p) => p.deductions.map((d) => d.evidence).join("; "), render: () => null, exportOnly: true },
            { key: "n", header: "Customer", csv: (p) => p.customer_name, render: (p) => <div><p className="font-medium">{p.customer_name}</p><p className="text-[0.72rem] text-faint">{p.customer_id} · {p.customer_type}, {p.region}{p.account_status !== "Active" ? ` · ${p.account_status}` : ""}</p></div> },
            { key: "h", header: "Health", csv: (p) => `${p.healthScore ?? ""} ${p.healthBand}`, render: (p) => <div className="flex items-center gap-2"><span className="w-7 text-right font-medium tabular-nums">{p.healthScore ?? "—"}</span><Badge tone={bandTone(p.healthBand)}>{p.healthBand}</Badge></div> },
            { key: "s", header: "Net sales (period)", align: "right", csv: (p) => Math.round(p.periodNetSales), render: (p) => formatPKR(p.periodNetSales) },
            { key: "t", header: "90-day trend", align: "right", render: (p) => <Delta value={p.salesTrendPct} digits={0} /> },
            { key: "r", header: "Last order", align: "right", render: (p) => (p.recencyDays === null ? "—" : `${p.recencyDays}d ago`) },
            { key: "o", header: "Overdue", align: "right", csv: (p) => Math.round(p.overdue), render: (p) => formatPKR(p.overdue) },
            { key: "c", header: "Credit used", align: "right", render: (p) => formatPct(p.creditUtilizationPct, 0) },
          ]}
        />
      </Panel>
    </>
  );
}
