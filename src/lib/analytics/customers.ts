/**
 * Customer & distributor intelligence, including a transparent, rule-based
 * account-health indicator.
 *
 * IMPORTANT: the health score is a set of business rules, NOT a machine-learning
 * model and NOT a validated prediction of default or churn. Each deduction is
 * returned as evidence so a manager can see exactly why an account scored low.
 * The thresholds are starting assumptions that a business should tune.
 */
import { addDays, daysBetween, inRange } from "./dates";
import { asOfDate, matchesDims, type Filters } from "./filters";
import type { Model } from "./model";
import { daysPastDue, outstandingAsOf } from "./receivables";
import { median } from "./anomalies";
import { formatPKR } from "./format";
import { getRules, type BusinessRules } from "../settings";

export interface HealthDeduction {
  rule: string;
  points: number;
  evidence: string;
}

export type HealthBand = "Healthy" | "Watch" | "Needs attention" | "Insufficient data";

export interface CustomerProfile {
  customer_id: string;
  customer_name: string;
  customer_type: string;
  channel: string;
  region: string;
  city: string;
  account_status: string;
  payment_terms_days: number;
  credit_limit_pkr: number;
  /** Net sales in the selected period. */
  periodNetSales: number;
  periodSharePct: number;
  /** Median days between orders over the last 12 months (null with fewer than 3 orders). */
  usualOrderGapDays: number | null;
  /** Trailing windows ending at the snapshot date (independent of period start). */
  sales90: number;
  salesPrev90: number;
  salesTrendPct: number | null;
  ordersLast180: number;
  ordersPerMonth: number;
  lastOrderDate: string | null;
  recencyDays: number | null;
  outstanding: number;
  overdue: number;
  overdueSharePct: number | null;
  oldestDaysPastDue: number;
  creditUtilizationPct: number | null;
  openHighComplaints: number;
  healthScore: number | null;
  healthBand: HealthBand;
  deductions: HealthDeduction[];
}

/** Plain-English description of the active health rules, for the UI and documentation. */
export function healthRuleDescriptions(rules: BusinessRules["health"] = getRules().health) {
  const r = rules;
  return [
    { rule: "Overdue share of outstanding", detail: `More than ${r.overdueShareHighPct}% overdue: −20. More than ${r.overdueShareWatchPct}%: −10.` },
    { rule: "Oldest overdue invoice", detail: `More than ${r.oldestOverdueHighDays} days past due: −20. More than ${r.oldestOverdueWatchDays} days: −10.` },
    {
      rule: "Order recency vs the customer's own rhythm",
      detail: "Days since last order more than 3× the customer's usual gap between orders (and over 60 days): −20. More than 2× (and over 45 days): −10.",
    },
    { rule: "Sales trend (last 90 days vs previous 90)", detail: `Down more than ${r.salesDropHighPct}%: −15. Down more than ${r.salesDropWatchPct}%: −5.` },
    { rule: "Credit utilisation", detail: `Outstanding above ${r.creditUseHighPct}% of credit limit: −15. Above ${r.creditUseWatchPct}%: −5.` },
    { rule: "Open high-severity complaints", detail: "One or more: −5." },
    { rule: "Bands", detail: `${r.healthyFrom}+ Healthy, ${r.watchFrom}–${r.healthyFrom - 1} Watch, below ${r.watchFrom} Needs attention.` },
    { rule: "Data sufficiency", detail: "Fewer than 3 orders in the last 12 months and no balance: not scored." },
  ];
}

const fmtM = (n: number) => formatPKR(n);

export function customerProfiles(model: Model, f: Filters, rules: BusinessRules["health"] = getRules().health): CustomerProfile[] {
  const R = rules;
  const asOf = asOfDate(model, f);
  const d90 = addDays(asOf, -89);
  const d180 = addDays(asOf, -179);
  const d365 = addDays(asOf, -364);
  const prevStart = addDays(asOf, -179);
  const prevEnd = addDays(asOf, -90);

  type Acc = { period: number; s90: number; sPrev90: number; o180: number; o365: number; last: string | null; dates365: string[]; gaps: number[] };
  const acc = new Map<string, Acc>();
  const get = (id: string) => {
    let a = acc.get(id);
    if (!a) {
      a = { period: 0, s90: 0, sPrev90: 0, o180: 0, o365: 0, last: null, dates365: [], gaps: [] };
      acc.set(id, a);
    }
    return a;
  };

  let periodTotal = 0;
  for (const o of model.orders) {
    if (o.order_date > asOf) continue;
    const isSale = o.order_status === "Delivered";
    const a = get(o.customer_id);
    if (inRange(o.order_date, f.start, f.end) && matchesDims(f, o)) {
      a.period += o.net_sales_pkr;
      periodTotal += o.net_sales_pkr;
    }
    if (o.order_date >= d90) a.s90 += o.net_sales_pkr;
    if (inRange(o.order_date, prevStart, prevEnd)) a.sPrev90 += o.net_sales_pkr;
    // order frequency and recency count real sales only, not credit notes
    if (!isSale) continue;
    if (o.order_date >= d180) a.o180 += 1;
    if (o.order_date >= d365) {
      a.o365 += 1;
      a.dates365.push(o.order_date);
    }
    if (!a.last || o.order_date > a.last) a.last = o.order_date;
  }

  // usual gap between orders over the last 12 months (distinct order days)
  for (const a of acc.values()) {
    const days = [...new Set(a.dates365)].sort();
    for (let i = 1; i < days.length; i++) a.gaps.push(daysBetween(days[i - 1], days[i]));
  }

  const recv = new Map<string, { out: number; overdue: number; oldest: number }>();
  for (const inv of model.invoices) {
    const out = outstandingAsOf(inv, asOf);
    if (out <= 0) continue;
    const r = recv.get(inv.customer_id) ?? { out: 0, overdue: 0, oldest: 0 };
    r.out += out;
    const dpd = daysPastDue(inv, asOf);
    if (dpd > 0) {
      r.overdue += out;
      r.oldest = Math.max(r.oldest, dpd);
    }
    recv.set(inv.customer_id, r);
  }

  const highComplaints = new Map<string, number>();
  for (const c of model.complaints) {
    const open = c.date_opened <= asOf && (c.status !== "Resolved" || (c.date_resolved !== "" && c.date_resolved > asOf));
    if (open && c.severity === "High") highComplaints.set(c.customer_id, (highComplaints.get(c.customer_id) ?? 0) + 1);
  }

  const profiles: CustomerProfile[] = [];
  for (const c of model.bundle.customers) {
    // customer-level filters: region and channel of the account
    if (!matchesDims({ ...f, categories: [], productIds: [] }, { region: c.region, channel: c.channel })) continue;
    if (c.onboarding_date > asOf) continue;
    const a = acc.get(c.customer_id) ?? { period: 0, s90: 0, sPrev90: 0, o180: 0, o365: 0, last: null, dates365: [], gaps: [] };
    const r = recv.get(c.customer_id) ?? { out: 0, overdue: 0, oldest: 0 };
    const recency = a.last ? daysBetween(a.last, asOf) : null;
    const trend = a.sPrev90 > 0 ? ((a.s90 - a.sPrev90) / a.sPrev90) * 100 : null;
    const overdueShare = r.out > 0 ? (r.overdue / r.out) * 100 : null;
    const util = c.credit_limit_pkr > 0 ? (r.out / c.credit_limit_pkr) * 100 : null;
    const highOpen = highComplaints.get(c.customer_id) ?? 0;

    const deductions: HealthDeduction[] = [];
    const sufficient = a.o365 >= 3 || r.out > 0;
    if (sufficient) {
      if (overdueShare !== null && overdueShare > R.overdueShareHighPct)
        deductions.push({ rule: "Overdue share", points: 20, evidence: `${overdueShare.toFixed(0)}% of ${fmtM(r.out)} outstanding is overdue` });
      else if (overdueShare !== null && overdueShare > R.overdueShareWatchPct)
        deductions.push({ rule: "Overdue share", points: 10, evidence: `${overdueShare.toFixed(0)}% of ${fmtM(r.out)} outstanding is overdue` });
      if (r.oldest > R.oldestOverdueHighDays) deductions.push({ rule: "Oldest overdue", points: 20, evidence: `Oldest overdue invoice is ${r.oldest} days past due` });
      else if (r.oldest > R.oldestOverdueWatchDays) deductions.push({ rule: "Oldest overdue", points: 10, evidence: `Oldest overdue invoice is ${r.oldest} days past due` });
      const gap = a.gaps.length >= 2 ? median(a.gaps) : null;
      const gapText = gap !== null ? ` (usual gap between orders: ${Math.round(gap)} days)` : "";
      if (recency === null)
        deductions.push({ rule: "Order recency", points: 20, evidence: "No delivered orders on record" });
      else if (recency > 60 && (gap === null || recency > 3 * gap))
        deductions.push({ rule: "Order recency", points: 20, evidence: `Last order ${recency} days ago${gapText}` });
      else if (recency > 45 && (gap === null || recency > 2 * gap))
        deductions.push({ rule: "Order recency", points: 10, evidence: `Last order ${recency} days ago${gapText}` });
      if (trend !== null && trend < -R.salesDropHighPct)
        deductions.push({ rule: "Sales trend", points: 15, evidence: `Last 90 days ${fmtM(a.s90)} vs ${fmtM(a.sPrev90)} in the previous 90 (${trend.toFixed(0)}%)` });
      else if (trend !== null && trend < -R.salesDropWatchPct)
        deductions.push({ rule: "Sales trend", points: 5, evidence: `Last 90 days ${fmtM(a.s90)} vs ${fmtM(a.sPrev90)} in the previous 90 (${trend.toFixed(0)}%)` });
      if (util !== null && util > R.creditUseHighPct)
        deductions.push({ rule: "Credit utilisation", points: 15, evidence: `Outstanding is ${util.toFixed(0)}% of the ${fmtM(c.credit_limit_pkr)} credit limit` });
      else if (util !== null && util > R.creditUseWatchPct)
        deductions.push({ rule: "Credit utilisation", points: 5, evidence: `Outstanding is ${util.toFixed(0)}% of the ${fmtM(c.credit_limit_pkr)} credit limit` });
      if (highOpen > 0) deductions.push({ rule: "Open high-severity complaints", points: 5, evidence: `${highOpen} open high-severity complaint(s)` });
    }
    const score = sufficient ? Math.max(0, 100 - deductions.reduce((s, d) => s + d.points, 0)) : null;
    const band: HealthBand = score === null ? "Insufficient data" : score >= R.healthyFrom ? "Healthy" : score >= R.watchFrom ? "Watch" : "Needs attention";

    profiles.push({
      customer_id: c.customer_id,
      customer_name: c.customer_name,
      customer_type: c.customer_type,
      channel: c.channel,
      region: c.region,
      city: c.city,
      account_status: c.account_status,
      payment_terms_days: c.payment_terms_days,
      credit_limit_pkr: c.credit_limit_pkr,
      periodNetSales: a.period,
      periodSharePct: periodTotal > 0 ? (a.period / periodTotal) * 100 : 0,
      sales90: a.s90,
      salesPrev90: a.sPrev90,
      salesTrendPct: trend,
      ordersLast180: a.o180,
      ordersPerMonth: a.o180 / 6,
      usualOrderGapDays: a.gaps.length >= 2 ? median(a.gaps) : null,
      lastOrderDate: a.last,
      recencyDays: recency,
      outstanding: r.out,
      overdue: r.overdue,
      overdueSharePct: overdueShare,
      oldestDaysPastDue: r.oldest,
      creditUtilizationPct: util,
      openHighComplaints: highOpen,
      healthScore: score,
      healthBand: band,
      deductions,
    });
  }
  return profiles.sort((x, y) => y.periodNetSales - x.periodNetSales);
}

/** Distributors (or any type) ranked by how much attention they need. */
export function accountsNeedingAttention(profiles: CustomerProfile[], type?: string): CustomerProfile[] {
  return profiles
    .filter((p) => (type ? p.customer_type === type : true) && p.healthScore !== null && p.account_status !== "Inactive")
    .filter((p) => p.healthBand !== "Healthy")
    .sort((a, b) => (a.healthScore ?? 0) - (b.healthScore ?? 0) || b.overdue - a.overdue);
}
