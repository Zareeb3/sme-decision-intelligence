/**
 * Management insights from complaints (imported + register) joined with
 * customers, products and sales.
 *
 * Every figure is a count or a simple statistic with its sample size. Patterns
 * between complaints and sales are reported as associations: they show where
 * to look, not what caused what.
 */
import { addDays, daysBetween, inRange } from "../analytics/dates";
import { allTimeFilters, asOfDate, filterComplaints, type Filters } from "../analytics/filters";
import type { EnrichedComplaint, Model } from "../analytics/model";
import { customerProfiles } from "../analytics/customers";
import { getRules, type BusinessRules } from "../settings";
import { currentPriority } from "./merge";
import { slaHours } from "./rules";
import { severityToPriority } from "./taxonomy";
import { isOpenStatus } from "./workflow";
import { PRIORITIES, type ComplaintCase, type Priority } from "./types";

const prio = (c: EnrichedComplaint): Priority => c.priority ?? severityToPriority(c.severity);
const isOpenAt = (c: EnrichedComplaint, asOf: string) => c.date_opened <= asOf && (c.status !== "Resolved" || (c.date_resolved !== "" && c.date_resolved > asOf));

function median(xs: number[]): number | null {
  if (!xs.length) return null;
  const s = [...xs].sort((a, b) => a - b);
  const m = Math.floor(s.length / 2);
  return s.length % 2 ? s[m] : (s[m - 1] + s[m]) / 2;
}

export interface RegisterStats {
  total: number;
  open: number;
  notTriaged: number;
  awaitingReview: number;
  escalatedOpen: number;
  responseOverdue: number;
  /** Agreement between the suggestion and the reviewer's confirmed triage. */
  agreement: { reviewed: number; category: number; priority: number; department: number; liveReviewed: number };
  byStatus: Record<string, number>;
}

/** Register state at `now` (the data snapshot for sample data, the real time for company data). */
export function registerStats(cases: ComplaintCase[], now: Date, rules: BusinessRules["complaints"] = getRules().complaints): RegisterStats {
  const open = cases.filter((c) => isOpenStatus(c.status));
  const firstHumanAction = (c: ComplaintCase) => c.history.find((h) => h.actor.kind === "person" && h.kind !== "created" && h.kind !== "note");
  const overdue = open.filter((c) => {
    const p = currentPriority(c).priority ?? "Medium";
    const start = Date.parse(c.createdAt);
    const act = firstHumanAction(c);
    const end = act ? Date.parse(act.at) : now.getTime();
    return !act && (end - start) / 3_600_000 > slaHours(p, rules);
  });
  const reviewed = cases.filter((c) => c.confirmed?.agreedWithSuggestion);
  const byStatus: Record<string, number> = {};
  for (const c of cases) byStatus[c.status] = (byStatus[c.status] ?? 0) + 1;
  return {
    total: cases.length,
    open: open.length,
    notTriaged: open.filter((c) => !c.assessments.length && !c.confirmed).length,
    awaitingReview: open.filter((c) => c.assessments.length > 0 && !c.confirmed).length,
    escalatedOpen: open.filter((c) => c.escalation.required && !c.escalation.acknowledgedBy).length,
    responseOverdue: overdue.length,
    agreement: {
      reviewed: reviewed.length,
      category: reviewed.filter((c) => c.confirmed!.agreedWithSuggestion!.category).length,
      priority: reviewed.filter((c) => c.confirmed!.agreedWithSuggestion!.priority).length,
      department: reviewed.filter((c) => c.confirmed!.agreedWithSuggestion!.department).length,
      liveReviewed: reviewed.filter((c) => c.confirmed!.suggestionMode === "live").length,
    },
    byStatus,
  };
}

export interface ComplaintInsights {
  asOf: string;
  openByPriority: { priority: Priority; total: number; age: { "0-7": number; "8-30": number; "31-60": number; "60+": number } }[];
  categoryTrend: { category: string; recent: number; previous: number; increasing: boolean }[];
  trendWindowDays: number;
  byRegion: { key: string; count: number; open: number }[];
  bySegment: { key: string; count: number; open: number }[];
  byProduct: { key: string; label: string; count: number; topCategory: string }[];
  repeatCustomers: { customer_id: string; name: string; count: number; categories: string[]; open: number }[];
  riskCustomers: { customer_id: string; name: string; type: string; region: string; score: number; reasons: string[]; openHighPriority: number; complaints180: number; salesTrendPct: number | null }[];
  recurringIssues: { product_id: string; product: string; category: string; count: number; customers: number; open: number }[];
  salesAssociation: { withComplaints: { n: number; medianTrendPct: number | null }; without: { n: number; medianTrendPct: number | null }; windowDays: number };
  periodComplaints: number;
}

export function complaintInsights(model: Model, f: Filters, rules: BusinessRules["complaints"] = getRules().complaints): ComplaintInsights {
  const asOf = asOfDate(model, f);
  const inPeriod = filterComplaints(model, f);
  const all = filterComplaints(model, f, { ignoreDates: true });
  const open = all.filter((c) => isOpenAt(c, asOf));

  const openByPriority = [...PRIORITIES].reverse().map((p) => {
    const rows = open.filter((c) => prio(c) === p);
    const age = { "0-7": 0, "8-30": 0, "31-60": 0, "60+": 0 };
    for (const c of rows) {
      const d = daysBetween(c.date_opened, asOf);
      age[d <= 7 ? "0-7" : d <= 30 ? "8-30" : d <= 60 ? "31-60" : "60+"] += 1;
    }
    return { priority: p, total: rows.length, age };
  });

  const W = 90;
  const recentStart = addDays(asOf, -(W - 1));
  const prevStart = addDays(recentStart, -W);
  const cats = new Set(all.filter((c) => c.date_opened >= prevStart && c.date_opened <= asOf && c.category !== "Not yet classified").map((c) => c.category));
  const categoryTrend = [...cats]
    .map((cat) => {
      const recent = all.filter((c) => c.category === cat && inRange(c.date_opened, recentStart, asOf)).length;
      const previous = all.filter((c) => c.category === cat && c.date_opened >= prevStart && c.date_opened < recentStart).length;
      return { category: cat, recent, previous, increasing: recent >= 3 && recent - previous >= 2 && recent >= 1.5 * previous };
    })
    .sort((a, b) => b.recent - b.previous - (a.recent - a.previous));

  const group = (key: (c: EnrichedComplaint) => string) => {
    const m = new Map<string, { count: number; open: number }>();
    for (const c of inPeriod) {
      const k = key(c) || "Unknown";
      const v = m.get(k) ?? { count: 0, open: 0 };
      v.count += 1;
      if (isOpenAt(c, asOf)) v.open += 1;
      m.set(k, v);
    }
    return [...m.entries()].map(([k, v]) => ({ key: k, ...v })).sort((a, b) => b.count - a.count);
  };
  const byRegion = group((c) => c.region);
  const bySegment = group((c) => c.customer_type ?? model.customersById.get(c.customer_id)?.customer_type ?? "Unknown");
  const prodMap = new Map<string, EnrichedComplaint[]>();
  for (const c of inPeriod) if (c.product_id) prodMap.set(c.product_id, [...(prodMap.get(c.product_id) ?? []), c]);
  const byProduct = [...prodMap.entries()]
    .map(([k, rows]) => {
      const cc = new Map<string, number>();
      for (const r of rows) cc.set(r.category, (cc.get(r.category) ?? 0) + 1);
      return { key: k, label: rows[0].product_name, count: rows.length, topCategory: [...cc.entries()].sort((a, b) => b[1] - a[1])[0][0] };
    })
    .sort((a, b) => b.count - a.count);

  // Repeat complaints by customer (180 days to the snapshot)
  const d180 = addDays(asOf, -179);
  const recent180 = all.filter((c) => c.customer_id && inRange(c.date_opened, d180, asOf));
  const byCust = new Map<string, EnrichedComplaint[]>();
  for (const c of recent180) byCust.set(c.customer_id, [...(byCust.get(c.customer_id) ?? []), c]);
  const repeatCustomers = [...byCust.entries()]
    .filter(([, rows]) => rows.length >= rules.repeatMinCount)
    .map(([id, rows]) => ({ customer_id: id, name: model.customersById.get(id)?.customer_name ?? id, count: rows.length, categories: [...new Set(rows.map((r) => r.category))], open: rows.filter((r) => isOpenAt(r, asOf)).length }))
    .sort((a, b) => b.count - a.count || b.open - a.open);

  // Customers with elevated complaint risk (transparent points)
  const profiles = new Map(customerProfiles(model, { ...allTimeFilters(model), start: addDays(asOf, -89), end: asOf }).map((p) => [p.customer_id, p]));
  const riskCustomers = [...byCust.entries()]
    .map(([id, rows]) => {
      const p = profiles.get(id);
      const openRows = rows.filter((r) => isOpenAt(r, asOf));
      const openHigh = openRows.filter((r) => prio(r) === "High" || prio(r) === "Critical").length;
      const escalated = openRows.filter((r) => r.escalated).length;
      const reasons: string[] = [];
      let score = 0;
      if (openHigh) {
        score += 2 * Math.min(openHigh, 2);
        reasons.push(`${openHigh} open high-priority complaint(s)`);
      }
      if (escalated) {
        score += 2;
        reasons.push(`${escalated} escalated complaint(s) awaiting management`);
      }
      if (rows.length >= 3) {
        score += 1;
        reasons.push(`${rows.length} complaints in 180 days`);
      }
      if (p?.salesTrendPct != null && p.salesTrendPct <= -10) {
        score += 1;
        reasons.push(`sales down ${Math.abs(p.salesTrendPct).toFixed(0)}% (last 90 days vs previous 90; an association, not a proven cause)`);
      }
      return { customer_id: id, name: p?.customer_name ?? model.customersById.get(id)?.customer_name ?? id, type: p?.customer_type ?? "Unknown", region: p?.region ?? "Unknown", score, reasons, openHighPriority: openHigh, complaints180: rows.length, salesTrendPct: p?.salesTrendPct ?? null };
    })
    .filter((r) => r.score >= 3)
    .sort((a, b) => b.score - a.score || b.complaints180 - a.complaints180);

  // Recurring issues: same product and category, at least the systemic threshold within its window
  const sysStart = addDays(asOf, -(rules.systemicWindowDays - 1));
  const pc = new Map<string, EnrichedComplaint[]>();
  for (const c of all) if (c.product_id && inRange(c.date_opened, sysStart, asOf)) pc.set(`${c.product_id}|${c.category}`, [...(pc.get(`${c.product_id}|${c.category}`) ?? []), c]);
  const recurringIssues = [...pc.entries()]
    .filter(([, rows]) => rows.length >= rules.systemicMinCount)
    .map(([k, rows]) => ({ product_id: k.split("|")[0], product: rows[0].product_name, category: rows[0].category, count: rows.length, customers: new Set(rows.map((r) => r.customer_id)).size, open: rows.filter((r) => isOpenAt(r, asOf)).length }))
    .sort((a, b) => b.count - a.count);

  // Association between complaints and sales trend (customers with sales in the previous 90 days)
  const d90 = addDays(asOf, -89);
  const complainedRecently = new Set(all.filter((c) => inRange(c.date_opened, d90, asOf)).map((c) => c.customer_id));
  const active = [...profiles.values()].filter((p) => p.salesPrev90 > 0 && p.salesTrendPct != null);
  const withC = active.filter((p) => complainedRecently.has(p.customer_id)).map((p) => p.salesTrendPct!);
  const withoutC = active.filter((p) => !complainedRecently.has(p.customer_id)).map((p) => p.salesTrendPct!);

  return {
    asOf,
    openByPriority,
    categoryTrend,
    trendWindowDays: W,
    byRegion,
    bySegment,
    byProduct,
    repeatCustomers,
    riskCustomers,
    recurringIssues,
    salesAssociation: { withComplaints: { n: withC.length, medianTrendPct: median(withC) }, without: { n: withoutC.length, medianTrendPct: median(withoutC) }, windowDays: 90 },
    periodComplaints: inPeriod.length,
  };
}
