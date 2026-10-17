"use client";

/**
 * The actionable complaint queue: what needs a decision, sorted by urgency.
 */
import { useMemo, useState } from "react";
import { Badge, Button, DataTable, MetricCard, Notice, Panel } from "../ui";
import { EscalatedBadge, inputCls, MachineLabel, PriorityBadge, StatusBadge } from "./shared";
import { currentCategory, currentPriority } from "@/lib/complaints/merge";
import { registerStats } from "@/lib/complaints/insights";
import { slaHours } from "@/lib/complaints/rules";
import { isOpenStatus } from "@/lib/complaints/workflow";
import { CASE_STATUSES, PRIORITIES, type ComplaintCase, type Priority } from "@/lib/complaints/types";
import type { Model } from "@/lib/analytics/model";
import { formatDate, formatNumber } from "@/lib/analytics/format";

type View = "attention" | "open" | "all" | "closed";

interface Row {
  c: ComplaintCase;
  customer: string;
  category: string | null;
  categoryConfirmed: boolean;
  department: string | null;
  priority: ReturnType<typeof currentPriority>;
  ageHours: number;
  overdue: boolean;
  needsDecision: string | null;
}

const rank = (r: Row) => [
  r.c.escalation.required && !r.c.escalation.acknowledgedBy ? 0 : 1,
  -(PRIORITIES.indexOf(r.priority.priority ?? "Low")),
  r.overdue ? 0 : 1,
  -r.ageHours,
];

export function ComplaintQueue({ model, cases, now, onOpen, onNew, onStartFromImport }: { model: Model; cases: ComplaintCase[]; now: Date; onOpen: (id: string) => void; onNew: () => void; onStartFromImport: (complaintId: string) => void }) {
  const [view, setView] = useState<View>("attention");
  const [q, setQ] = useState("");
  const [status, setStatus] = useState("");
  const [priority, setPriority] = useState("");
  const [dept, setDept] = useState("");
  const stats = useMemo(() => registerStats(cases, now), [cases, now]);

  const rows = useMemo<Row[]>(() => {
    return cases.map((c) => {
      const cat = currentCategory(c);
      const pr = currentPriority(c);
      const ageHours = (now.getTime() - Date.parse(c.createdAt)) / 3_600_000;
      const humanActed = c.history.some((h) => h.actor.kind === "person" && h.kind !== "created" && h.kind !== "note");
      const overdue = isOpenStatus(c.status) && !humanActed && ageHours > slaHours(pr.priority ?? "Medium");
      const needsDecision = !isOpenStatus(c.status)
        ? null
        : c.escalation.required && !c.escalation.acknowledgedBy
          ? "Management acknowledgement"
          : !c.assessments.length && !c.confirmed
            ? "Triage"
            : !c.confirmed
              ? "Review suggestion"
              : null;
      return {
        c,
        customer: c.customerId ? (model.customersById.get(c.customerId)?.customer_name ?? c.customerId) : c.customerNameEntered || "Unknown customer",
        category: cat.category,
        categoryConfirmed: cat.confirmed,
        department: cat.department,
        priority: pr,
        ageHours,
        overdue,
        needsDecision,
      };
    });
  }, [cases, model, now]);

  const departments = useMemo(() => [...new Set(rows.map((r) => r.department).filter(Boolean) as string[])].sort(), [rows]);

  const filtered = useMemo(() => {
    const term = q.trim().toLowerCase();
    return rows
      .filter((r) => (view === "attention" ? Boolean(r.needsDecision) || r.overdue : view === "open" ? isOpenStatus(r.c.status) : view === "closed" ? !isOpenStatus(r.c.status) : true))
      .filter((r) => !status || r.c.status === status)
      .filter((r) => !priority || r.priority.priority === priority)
      .filter((r) => !dept || r.department === dept)
      .filter((r) => !term || [r.c.id, r.customer, r.c.originalText, r.category ?? "", r.c.orderRef ?? "", r.c.linkedComplaintId ?? ""].some((s) => s.toLowerCase().includes(term)))
      .sort((a, b) => {
        const ra = rank(a), rb = rank(b);
        for (let i = 0; i < ra.length; i++) if (ra[i] !== rb[i]) return ra[i] - rb[i];
        return 0;
      });
  }, [rows, view, q, status, priority, dept]);

  const caseFor = new Set(cases.map((c) => c.linkedComplaintId).filter(Boolean));
  const importedOpen = model.complaints.filter((c) => c.origin !== "register" && !caseFor.has(c.complaint_id) && c.status !== "Resolved");

  const tabs: { id: View; label: string; count: number }[] = [
    { id: "attention", label: "Needs a decision", count: rows.filter((r) => r.needsDecision || r.overdue).length },
    { id: "open", label: "All open", count: rows.filter((r) => isOpenStatus(r.c.status)).length },
    { id: "closed", label: "Resolved & closed", count: rows.filter((r) => !isOpenStatus(r.c.status)).length },
    { id: "all", label: "All", count: rows.length },
  ];

  return (
    <>
      <div className="grid grid-cols-2 gap-3 lg:grid-cols-5">
        <MetricCard label="Open complaints" value={formatNumber(stats.open)} sub={`${stats.total} in the register`} />
        <MetricCard label="Escalated, awaiting management" value={formatNumber(stats.escalatedOpen)} tone={stats.escalatedOpen ? "risk" : "good"} />
        <MetricCard label="Suggestions awaiting review" value={formatNumber(stats.awaitingReview)} tone={stats.awaitingReview ? "watch" : "good"} />
        <MetricCard label="Not yet triaged" value={formatNumber(stats.notTriaged)} tone={stats.notTriaged ? "watch" : "good"} />
        <MetricCard label="Past first-response target" value={formatNumber(stats.responseOverdue)} tone={stats.responseOverdue ? "risk" : "good"} sub="No decision yet within the target hours" />
      </div>

      <PriorityStatusMatrix rows={rows} />

      <Panel
        className="mt-6"
        title="Complaint queue"
        subtitle="Escalations first, then priority, then overdue and oldest. Open a complaint to review the suggestion and decide."
        actions={<Button onClick={onNew}>Record a complaint</Button>}
      >
        <div className="mb-4 flex flex-wrap items-center gap-1.5" role="tablist" aria-label="Queue view">
          {tabs.map((t) => (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={view === t.id}
              onClick={() => setView(t.id)}
              className={`rounded-md px-3 py-1.5 text-[0.82rem] ${view === t.id ? "bg-glaze-soft font-medium text-glaze-deep" : "text-muted hover:bg-paper hover:text-ink"}`}
            >
              {t.label} <span className="tabular-nums text-faint">{t.count}</span>
            </button>
          ))}
        </div>
        <div className="mb-4 grid grid-cols-1 gap-2 sm:grid-cols-2 lg:grid-cols-[2fr_1fr_1fr_1fr]">
          <input value={q} onChange={(e) => setQ(e.target.value)} placeholder="Search text, customer, ID or order" className={inputCls} aria-label="Search complaints" />
          <select value={status} onChange={(e) => setStatus(e.target.value)} className={inputCls} aria-label="Status">
            <option value="">All statuses</option>
            {CASE_STATUSES.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={priority} onChange={(e) => setPriority(e.target.value)} className={inputCls} aria-label="Priority">
            <option value="">All priorities</option>
            {[...PRIORITIES].reverse().map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
          <select value={dept} onChange={(e) => setDept(e.target.value)} className={inputCls} aria-label="Department">
            <option value="">All departments</option>
            {departments.map((s) => (
              <option key={s}>{s}</option>
            ))}
          </select>
        </div>
        <DataTable
          rows={filtered}
          rowKey={(r) => r.c.id}
          onRowClick={(r) => onOpen(r.c.id)}
          empty={view === "attention" ? "Nothing is waiting for a decision." : "No complaints match these filters."}
          exportName="complaint-queue"
          columns={[
            {
              key: "id",
              header: "Complaint",
              render: (r) => (
                <div className="min-w-[13rem] max-w-[26rem]">
                  <p className="font-medium text-glaze-deep">
                    {r.c.id} <span className="font-normal text-muted">· {r.customer}</span>
                  </p>
                  <p className="mt-0.5 line-clamp-2 text-[0.78rem] text-muted">{r.c.originalText}</p>
                </div>
              ),
              csv: (r) => r.c.id,
            },
            { key: "cust", header: "Customer", exportOnly: true, render: (r) => r.customer, csv: (r) => r.customer },
            { key: "s", header: "Status", render: (r) => <div className="space-y-1"><StatusBadge status={r.c.status} />{r.c.escalation.required && !r.c.escalation.acknowledgedBy && <div><EscalatedBadge /></div>}</div>, csv: (r) => r.c.status },
            { key: "p", header: "Priority", render: (r) => <PriorityBadge priority={r.priority.priority} confirmed={r.priority.confirmed} />, csv: (r) => r.priority.priority, sortValue: (r) => PRIORITIES.indexOf(r.priority.priority ?? "Low") },
            {
              key: "c",
              header: "Category · department",
              render: (r) => (
                <div className="text-[0.82rem]">
                  <p>{r.category ?? <span className="text-faint">Not classified</span>}</p>
                  <p className="text-faint">{r.department ?? "—"}{!r.categoryConfirmed && r.category ? " · suggested" : ""}</p>
                </div>
              ),
              csv: (r) => r.category,
            },
            {
              key: "n",
              header: "Next decision",
              render: (r) =>
                r.needsDecision ? <Badge tone={r.needsDecision === "Management acknowledgement" ? "risk" : "watch"}>{r.needsDecision}</Badge> : r.overdue ? <Badge tone="risk">Response overdue</Badge> : <span className="text-faint">—</span>,
              csv: (r) => r.needsDecision ?? "",
            },
            { key: "r", header: "Received", align: "right", render: (r) => <span className="text-[0.82rem]">{formatDate(r.c.receivedDate)}<br /><span className="text-faint">{r.c.channel}</span></span>, csv: (r) => r.c.receivedDate },
          ]}
        />
      </Panel>

      {importedOpen.length > 0 && (
        <Panel className="mt-6" title="Imported complaints without a case" subtitle="Open complaints from your complaint data (for example SAP QM notifications) that have not been opened in the register yet. The import has no customer text, so add it to run triage.">
          <ul className="divide-y divide-line">
            {importedOpen.slice(0, 20).map((c) => (
              <li key={c.complaint_id} className="flex flex-wrap items-center justify-between gap-3 py-2.5 first:pt-0 last:pb-0">
                <div className="text-[0.85rem]">
                  <p className="font-medium">
                    {c.complaint_id} · {model.customersById.get(c.customer_id)?.customer_name ?? c.customer_id}
                  </p>
                  <p className="text-[0.78rem] text-muted">
                    {c.category} on {c.product_name} · {c.severity} severity · opened {formatDate(c.date_opened)} · {c.status}
                  </p>
                </div>
                <Button variant="secondary" onClick={() => onStartFromImport(c.complaint_id)}>
                  Open a case
                </Button>
              </li>
            ))}
          </ul>
        </Panel>
      )}
      {cases.length === 0 && (
        <div className="mt-6">
          <Notice tone="primary">The register is empty. Record a complaint, or open a case for an imported complaint, to start the triage workflow.</Notice>
        </div>
      )}
    </>
  );
}

function PriorityStatusMatrix({ rows }: { rows: Row[] }) {
  const open = rows.filter((r) => isOpenStatus(r.c.status));
  const statuses = CASE_STATUSES.filter((s) => s !== "Resolved" && s !== "Closed");
  const prios: (Priority | null)[] = [...[...PRIORITIES].reverse(), null];
  if (!open.length) return null;
  const max = Math.max(1, ...prios.flatMap((p) => statuses.map((s) => open.filter((r) => (r.priority.priority ?? null) === p && r.c.status === s).length)));
  return (
    <Panel className="mt-6" title="Open complaints by priority and status" subtitle="Priorities are confirmed by a person where available, otherwise the latest suggestion.">
      <div className="-mx-5 overflow-x-auto px-5">
        <table className="w-full min-w-[520px] border-separate border-spacing-1 text-[0.82rem]">
          <thead>
            <tr className="text-left text-[0.74rem] text-muted">
              <th className="font-medium">Priority</th>
              {statuses.map((s) => (
                <th key={s} className="text-center font-medium">
                  {s}
                </th>
              ))}
              <th className="text-right font-medium">Total</th>
            </tr>
          </thead>
          <tbody>
            {prios.map((p) => {
              const tot = open.filter((r) => (r.priority.priority ?? null) === p).length;
              if (p === null && tot === 0) return null;
              return (
                <tr key={p ?? "none"}>
                  <td className="py-1">{p ? <PriorityBadge priority={p} /> : <span className="text-[0.78rem] text-muted">Not triaged</span>}</td>
                  {statuses.map((s) => {
                    const n = open.filter((r) => (r.priority.priority ?? null) === p && r.c.status === s).length;
                    const heat = n / max;
                    const hot = p === "Critical" || p === "High";
                    return (
                      <td key={s} className="rounded text-center tabular-nums" style={{ background: n ? (hot ? `rgba(159,58,49,${0.08 + heat * 0.32})` : `rgba(29,107,116,${0.06 + heat * 0.26})`) : "transparent" }}>
                        <span className={n ? "font-semibold" : "text-faint"}>{n}</span>
                      </td>
                    );
                  })}
                  <td className="text-right font-semibold tabular-nums">{tot}</td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
      <p className="mt-2 flex flex-wrap items-center gap-2 text-[0.74rem] text-faint">
        <MachineLabel mode="rules" /> and <MachineLabel mode="live" /> labels mark suggestions; nothing becomes final until a person confirms it.
      </p>
    </Panel>
  );
}
