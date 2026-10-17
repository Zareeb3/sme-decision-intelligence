/**
 * Receivables: outstanding balances, overdue balances and aging, all computed
 * "as of" a snapshot date.
 *
 * Because each invoice records its payment date, we can reconstruct what was
 * outstanding on any past date: a payment only counts if it happened on or
 * before the snapshot date. This makes the date filter behave correctly for
 * receivables, not just for sales.
 */
import { daysBetween } from "./dates";
import { asOfDate, filterInvoicesByDims, type Filters } from "./filters";
import type { EnrichedInvoice, Model } from "./model";

export const AGING_BUCKETS = ["Not yet due", "1–30 days", "31–60 days", "61–90 days", "90+ days"] as const;
export type AgingBucket = (typeof AGING_BUCKETS)[number];

/** Amount paid on or before `asOf`. Single payment record per invoice (dataset simplification). */
export function paidAsOf(inv: EnrichedInvoice, asOf: string): number {
  return inv.payment_date && inv.payment_date <= asOf ? inv.amount_paid_pkr : 0;
}

/** Outstanding balance on `asOf`; zero for invoices raised after `asOf`. Never negative. */
export function outstandingAsOf(inv: EnrichedInvoice, asOf: string): number {
  if (inv.invoice_date > asOf) return 0;
  return Math.max(0, inv.invoice_amount_pkr - paidAsOf(inv, asOf));
}

/** Days past the due date on `asOf` (zero or negative means not yet due). */
export function daysPastDue(inv: EnrichedInvoice, asOf: string): number {
  return daysBetween(inv.due_date, asOf);
}

export function agingBucket(daysPast: number): AgingBucket {
  if (daysPast <= 0) return "Not yet due";
  if (daysPast <= 30) return "1–30 days";
  if (daysPast <= 60) return "31–60 days";
  if (daysPast <= 90) return "61–90 days";
  return "90+ days";
}

export interface ReceivablesSnapshot {
  asOf: string;
  outstanding: number;
  overdue: number;
  overduePct: number | null;
  over90: number;
  openInvoiceCount: number;
  overdueInvoiceCount: number;
  aging: { bucket: AgingBucket; amount: number; invoices: number }[];
}

export function receivablesSnapshot(model: Model, f: Filters, asOfOverride?: string): ReceivablesSnapshot {
  const asOf = asOfOverride ?? asOfDate(model, f);
  const aging = new Map<AgingBucket, { amount: number; invoices: number }>(
    AGING_BUCKETS.map((b) => [b, { amount: 0, invoices: 0 }]),
  );
  let outstanding = 0;
  let overdue = 0;
  let over90 = 0;
  let openInvoiceCount = 0;
  let overdueInvoiceCount = 0;

  for (const inv of filterInvoicesByDims(model, f)) {
    const out = outstandingAsOf(inv, asOf);
    if (out <= 0) continue;
    const dpd = daysPastDue(inv, asOf);
    const bucket = agingBucket(dpd);
    const b = aging.get(bucket)!;
    b.amount += out;
    b.invoices += 1;
    outstanding += out;
    openInvoiceCount += 1;
    if (dpd > 0) {
      overdue += out;
      overdueInvoiceCount += 1;
    }
    if (dpd > 90) over90 += out;
  }
  return {
    asOf,
    outstanding,
    overdue,
    overduePct: outstanding > 0 ? (overdue / outstanding) * 100 : null,
    over90,
    openInvoiceCount,
    overdueInvoiceCount,
    aging: AGING_BUCKETS.map((bucket) => ({ bucket, ...aging.get(bucket)! })),
  };
}

export interface CustomerReceivable {
  customer_id: string;
  customer_name: string;
  customer_type: string;
  region: string;
  payment_terms_days: number;
  credit_limit_pkr: number;
  outstanding: number;
  overdue: number;
  over90: number;
  oldestDaysPastDue: number;
  overdueInvoices: number;
  /** Outstanding as % of credit limit; null when no credit limit is recorded. */
  creditUtilizationPct: number | null;
}

export function receivablesByCustomer(model: Model, f: Filters, asOfOverride?: string): CustomerReceivable[] {
  const asOf = asOfOverride ?? asOfDate(model, f);
  const map = new Map<string, CustomerReceivable>();
  for (const inv of filterInvoicesByDims(model, f)) {
    const out = outstandingAsOf(inv, asOf);
    if (out <= 0) continue;
    let row = map.get(inv.customer_id);
    if (!row) {
      const c = model.customersById.get(inv.customer_id);
      row = {
        customer_id: inv.customer_id,
        customer_name: c?.customer_name ?? inv.customer_id,
        customer_type: c?.customer_type ?? "Unknown",
        region: c?.region ?? inv.region,
        payment_terms_days: c?.payment_terms_days ?? 0,
        credit_limit_pkr: c?.credit_limit_pkr ?? 0,
        outstanding: 0,
        overdue: 0,
        over90: 0,
        oldestDaysPastDue: 0,
        overdueInvoices: 0,
        creditUtilizationPct: null,
      };
      map.set(inv.customer_id, row);
    }
    const dpd = daysPastDue(inv, asOf);
    row.outstanding += out;
    if (dpd > 0) {
      row.overdue += out;
      row.overdueInvoices += 1;
      row.oldestDaysPastDue = Math.max(row.oldestDaysPastDue, dpd);
    }
    if (dpd > 90) row.over90 += out;
  }
  const rows = [...map.values()];
  for (const r of rows) r.creditUtilizationPct = r.credit_limit_pkr > 0 ? (r.outstanding / r.credit_limit_pkr) * 100 : null;
  return rows.sort((a, b) => b.overdue - a.overdue || b.outstanding - a.outstanding);
}

/** Overdue balance by region at the snapshot date. */
export function overdueByRegion(model: Model, f: Filters, asOfOverride?: string) {
  const asOf = asOfOverride ?? asOfDate(model, f);
  const map = new Map<string, { region: string; outstanding: number; overdue: number }>();
  for (const inv of filterInvoicesByDims(model, f)) {
    const out = outstandingAsOf(inv, asOf);
    if (out <= 0) continue;
    const r = map.get(inv.region) ?? { region: inv.region, outstanding: 0, overdue: 0 };
    r.outstanding += out;
    if (daysPastDue(inv, asOf) > 0) r.overdue += out;
    map.set(inv.region, r);
  }
  return [...map.values()].sort((a, b) => b.overdue - a.overdue);
}
