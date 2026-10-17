/**
 * Workflow actions proposed from the analytics, for optional n8n automation.
 *
 * Nothing is sent automatically. Each action is shown to the user with its
 * exact payload; it is only sent after a named person approves it, and only to
 * the webhook URL configured on the server (N8N_WEBHOOK_URL).
 */
import { z } from "zod";
import type { Filters } from "./analytics/filters";
import type { Model } from "./analytics/model";
import { computeKpis } from "./analytics/kpis";
import { receivablesByCustomer } from "./analytics/receivables";
import { accountsNeedingAttention, customerProfiles } from "./analytics/customers";
import { complaintSummary } from "./analytics/complaints";
import { formatPKR, formatPct } from "./analytics/format";

export const ACTION_TYPES = ["overdue_alert", "follow_up_task", "complaint_routing", "management_summary"] as const;
export type ActionType = (typeof ACTION_TYPES)[number];

export const ACTION_LABELS: Record<ActionType, string> = {
  overdue_alert: "Overdue-balance alert",
  follow_up_task: "Customer follow-up task",
  complaint_routing: "Route complaint to team",
  management_summary: "Management summary",
};

export const proposedActionSchema = z.object({
  id: z.string().max(80),
  type: z.enum(ACTION_TYPES),
  title: z.string().max(200),
  reason: z.string().max(500),
  recipient: z.string().max(120),
  payload: z.record(z.unknown()),
});
export type ProposedAction = z.infer<typeof proposedActionSchema>;

export const approvalRequestSchema = z.object({
  action: proposedActionSchema,
  approval: z.object({
    approved: z.literal(true),
    approverName: z.string().trim().min(2, "Enter the name of the person approving").max(80),
    note: z.string().max(300).optional(),
  }),
});

export interface ActionOptions {
  overdueThresholdPkr: number;
  maxPerType: number;
}

export const DEFAULT_ACTION_OPTIONS: ActionOptions = { overdueThresholdPkr: 10_000_000, maxPerType: 5 };

export function proposeActions(model: Model, f: Filters, opts: ActionOptions = DEFAULT_ACTION_OPTIONS): ProposedAction[] {
  const actions: ProposedAction[] = [];
  const k = computeKpis(model, f);
  const asOf = k.period.asOf;

  for (const r of receivablesByCustomer(model, f).filter((x) => x.overdue >= opts.overdueThresholdPkr).slice(0, opts.maxPerType)) {
    actions.push({
      id: `overdue_alert:${r.customer_id}:${asOf}`,
      type: "overdue_alert",
      title: `Overdue alert: ${r.customer_name}`,
      reason: `${formatPKR(r.overdue)} overdue (threshold ${formatPKR(opts.overdueThresholdPkr)}); oldest invoice ${r.oldestDaysPastDue} days past due.`,
      recipient: "Credit control",
      payload: {
        customer_id: r.customer_id,
        customer_name: r.customer_name,
        region: r.region,
        overdue_pkr: Math.round(r.overdue),
        outstanding_pkr: Math.round(r.outstanding),
        oldest_days_past_due: r.oldestDaysPastDue,
        threshold_pkr: opts.overdueThresholdPkr,
        as_of: asOf,
      },
    });
  }

  for (const p of accountsNeedingAttention(customerProfiles(model, f)).filter((x) => x.healthBand === "Needs attention").slice(0, opts.maxPerType)) {
    actions.push({
      id: `follow_up_task:${p.customer_id}:${asOf}`,
      type: "follow_up_task",
      title: `Follow up with ${p.customer_name}`,
      reason: `Health score ${p.healthScore}/100: ${p.deductions.map((d) => d.evidence).join("; ")}.`,
      recipient: `${p.region} sales team`,
      payload: {
        customer_id: p.customer_id,
        customer_name: p.customer_name,
        customer_type: p.customer_type,
        region: p.region,
        health_score: p.healthScore,
        reasons: p.deductions.map((d) => d.evidence),
        suggested_due_in_days: 7,
        as_of: asOf,
      },
    });
  }

  const cs = complaintSummary(model, f);
  for (const c of cs.openList.filter((x) => x.severity !== "Low").slice(0, opts.maxPerType)) {
    actions.push({
      id: `complaint_routing:${c.complaint_id}`,
      type: "complaint_routing",
      title: `Route ${c.complaint_id} to ${c.assigned_team}`,
      reason: `${c.severity}-severity ${c.category.toLowerCase()} on ${c.product_name}, open ${c.ageDays} days.`,
      recipient: `${c.assigned_team} team`,
      payload: {
        complaint_id: c.complaint_id,
        customer_id: c.customer_id,
        order_id: c.order_id,
        product: c.product_name,
        category: c.category,
        severity: c.severity,
        team: c.assigned_team,
        age_days: c.ageDays,
        claim_value_pkr: c.claim_value_pkr,
      },
    });
  }

  actions.push({
    id: `management_summary:${f.start}:${f.end}`,
    type: "management_summary",
    title: "Send management summary",
    reason: "Weekly or period-end summary of verified KPIs for the management team.",
    recipient: "Management team",
    payload: {
      period: `${f.start} to ${f.end}`,
      as_of: asOf,
      net_sales: formatPKR(k.netSales),
      sales_attainment: formatPct(k.salesAttainmentPct),
      collections: formatPKR(k.collections),
      collection_attainment: formatPct(k.collectionAttainmentPct),
      estimated_gross_margin: formatPct(k.estGrossMarginPct),
      overdue: formatPKR(k.overdue),
      overdue_share: formatPct(k.overduePct),
      open_complaints: k.openComplaints,
      complaint_spikes: cs.spikes.map((s) => s.product_name),
      note: "Figures from the SME Decision Intelligence analytics engine (synthetic demo data).",
    },
  });

  return actions;
}
