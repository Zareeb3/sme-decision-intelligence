/**
 * Filters shared by every page and by the AI analyst.
 *
 * Rules (also documented in docs/KPI_DEFINITIONS.md):
 *  - Sales metrics use orders whose order_date is inside [start, end].
 *  - Collections use payments whose payment_date is inside [start, end].
 *  - Receivables are a snapshot "as of" the period end (or the latest date in
 *    the data, whichever is earlier) and include older unpaid invoices.
 *  - Region / channel / product filters apply to every record through the
 *    order (or the customer, when an invoice has no matching order).
 */
import { daysBetween, inRange, monthEnd, monthStart, monthsBetween } from "./dates";
import type { EnrichedComplaint, EnrichedInvoice, Model } from "./model";
import type { Order, Target } from "../data/types";

export interface Filters {
  start: string;
  end: string;
  regions: string[];
  channels: string[];
  categories: string[];
  productIds: string[];
}

export function defaultFilters(model: Model, months = 3): Filters {
  // Default: the last `months` complete months in the data.
  const lastMonth = model.maxDate.slice(0, 7);
  const isComplete = model.maxDate === monthEnd(lastMonth);
  const all = monthsBetween(model.minDate, model.maxDate);
  const usable = isComplete ? all : all.slice(0, -1);
  const chosen = usable.slice(-months);
  return {
    start: monthStart(chosen[0] ?? lastMonth),
    end: monthEnd(chosen[chosen.length - 1] ?? lastMonth),
    regions: [],
    channels: [],
    categories: [],
    productIds: [],
  };
}

export function allTimeFilters(model: Model): Filters {
  return { start: model.minDate, end: model.maxDate, regions: [], channels: [], categories: [], productIds: [] };
}

/** The date used for receivables snapshots: period end, capped at the data's last date. */
export function asOfDate(model: Model, f: Filters): string {
  return f.end < model.maxDate ? f.end : model.maxDate;
}

const pass = (selected: string[], value: string) => selected.length === 0 || selected.includes(value);

export function matchesDims(
  f: Filters,
  rec: { region: string; channel: string; product_category?: string; product_id?: string },
): boolean {
  if (!pass(f.regions, rec.region) || !pass(f.channels, rec.channel)) return false;
  // Product filters only match records that are linked to a product.
  if (f.categories.length > 0 && !(rec.product_category && f.categories.includes(rec.product_category))) return false;
  if (f.productIds.length > 0 && !(rec.product_id && f.productIds.includes(rec.product_id))) return false;
  return true;
}

export function hasProductFilter(f: Filters): boolean {
  return f.categories.length > 0 || f.productIds.length > 0;
}

/**
 * Sales lines in the period that match the dimension filters: delivered lines
 * plus credit notes (negative). Cancelled lines are never included.
 */
export function filterOrders(model: Model, f: Filters): Order[] {
  return model.orders.filter((o) => inRange(o.order_date, f.start, f.end) && matchesDims(f, o));
}

/** Invoices matching dimension filters, regardless of date (callers apply date logic). */
export function filterInvoicesByDims(model: Model, f: Filters): EnrichedInvoice[] {
  return model.invoices.filter((i) => matchesDims(f, i));
}

export function filterComplaints(model: Model, f: Filters, opts: { ignoreDates?: boolean } = {}): EnrichedComplaint[] {
  return model.complaints.filter(
    (c) => (opts.ignoreDates || inRange(c.date_opened, f.start, f.end)) && matchesDims(f, c),
  );
}

/**
 * Targets are set per region and month, so attainment is only meaningful when
 * no channel or product filter is active.
 */
export function targetsApplicable(f: Filters): boolean {
  return f.channels.length === 0 && !hasProductFilter(f);
}

/**
 * Sum of targets for the period. Partial months are pro-rated by the number of
 * days covered (e.g. 1–15 June counts 15/30 of June's target).
 */
export function sumTargets(
  targets: Target[],
  f: Filters,
  field: "sales_target_pkr" | "collection_target_pkr",
): number {
  const months = monthsBetween(f.start, f.end);
  let total = 0;
  for (const m of months) {
    const ms = monthStart(m);
    const me = monthEnd(m);
    const from = f.start > ms ? f.start : ms;
    const to = f.end < me ? f.end : me;
    const share = (daysBetween(from, to) + 1) / (daysBetween(ms, me) + 1);
    for (const t of targets) {
      if (t.month === m && pass(f.regions, t.region)) total += t[field] * share;
    }
  }
  return total;
}

export function describeFilters(f: Filters): string {
  const parts = [`${f.start} to ${f.end}`];
  if (f.regions.length) parts.push(`region: ${f.regions.join(", ")}`);
  if (f.channels.length) parts.push(`channel: ${f.channels.join(", ")}`);
  if (f.categories.length) parts.push(`category: ${f.categories.join(", ")}`);
  if (f.productIds.length) parts.push(`products: ${f.productIds.join(", ")}`);
  return parts.join("; ");
}
