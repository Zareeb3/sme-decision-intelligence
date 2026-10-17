/**
 * Headline KPIs for a filter selection. Pure function: same data + filters in,
 * same numbers out. Every field is defined in ./definitions.ts.
 */
import { addDays, inRange } from "./dates";
import {
  asOfDate,
  filterComplaints,
  filterInvoicesByDims,
  filterOrders,
  sumTargets,
  targetsApplicable,
  type Filters,
} from "./filters";
import type { Model } from "./model";
import { cashReceivedIn, outstandingAsOf, paidAsOf, receivablesSnapshot } from "./receivables";

export interface KpiSet {
  period: { start: string; end: string; asOf: string };
  netSales: number;
  estCogs: number;
  estGrossProfit: number;
  estGrossMarginPct: number | null;
  orderCount: number;
  volumeSqm: number;
  /** Discount weighted by gross (pre-discount) value. */
  avgDiscountPct: number | null;
  activeCustomers: number;
  salesTarget: number | null;
  salesAttainmentPct: number | null;
  collections: number;
  collectionTarget: number | null;
  collectionAttainmentPct: number | null;
  outstanding: number;
  overdue: number;
  overduePct: number | null;
  over90: number;
  invoicesRaised: number;
  invoicePaidRatioPct: number | null;
  invoiceValuePaidPct: number | null;
  /** Simple days-sales-outstanding: outstanding / (net sales of last 90 days / 90). */
  dso90: number | null;
  openComplaints: number;
  complaintsOpened: number;
  targetsAvailable: boolean;
}

const pct = (num: number, den: number): number | null => (den > 0 ? (num / den) * 100 : null);

export function computeKpis(model: Model, f: Filters): KpiSet {
  const asOf = asOfDate(model, f);
  const orders = filterOrders(model, f);

  let netSales = 0;
  let estCogs = 0;
  let volumeSqm = 0;
  let grossValue = 0;
  const customers = new Set<string>();
  let deliveredLines = 0;
  for (const o of orders) {
    if (o.order_status === "Delivered") deliveredLines += 1;
    netSales += o.net_sales_pkr;
    estCogs += o.est_cogs_pkr;
    volumeSqm += o.quantity_sqm;
    grossValue += o.quantity_sqm * o.list_price_per_sqm;
    if (o.order_status === "Delivered") customers.add(o.customer_id);
  }
  const estGrossProfit = netSales - estCogs;

  // Collections = payments received within the period (by payment date).
  const dimInvoices = filterInvoicesByDims(model, f);
  let collections = 0;
  let invoicesRaised = 0;
  let invoicesFullyPaid = 0;
  let invoicedValue = 0;
  let paidValue = 0;
  for (const inv of dimInvoices) {
    collections += cashReceivedIn(inv, f.start, f.end);
    if (inRange(inv.invoice_date, f.start, f.end)) {
      invoicesRaised += 1;
      invoicedValue += inv.invoice_amount_pkr;
      const paid = paidAsOf(inv, asOf);
      paidValue += Math.min(paid, inv.invoice_amount_pkr);
      if (outstandingAsOf(inv, asOf) <= 1) invoicesFullyPaid += 1;
    }
  }

  const rec = receivablesSnapshot(model, f, asOf);

  // DSO over a trailing 90-day window ending at the snapshot date.
  const windowStart = addDays(asOf, -89);
  const sales90 = filterOrders(model, { ...f, start: windowStart, end: asOf }).reduce((s, o) => s + o.net_sales_pkr, 0);
  const dso90 = sales90 > 0 ? rec.outstanding / (sales90 / 90) : null;

  const targetsAvailable = targetsApplicable(f) && model.bundle.targets.length > 0;
  const salesTarget = targetsAvailable ? sumTargets(model.bundle.targets, f, "sales_target_pkr") : null;
  const collectionTarget = targetsAvailable ? sumTargets(model.bundle.targets, f, "collection_target_pkr") : null;

  const complaintsInPeriod = filterComplaints(model, f);
  // "Open" complaints are counted at the snapshot date across all history.
  const openComplaints = filterComplaints(model, f, { ignoreDates: true }).filter(
    (c) => c.date_opened <= asOf && (c.status !== "Resolved" || (c.date_resolved && c.date_resolved > asOf)),
  ).length;

  return {
    period: { start: f.start, end: f.end, asOf },
    netSales,
    estCogs,
    estGrossProfit,
    estGrossMarginPct: pct(estGrossProfit, netSales),
    orderCount: deliveredLines,
    volumeSqm,
    avgDiscountPct: grossValue > 0 ? (1 - netSales / grossValue) * 100 : null,
    activeCustomers: customers.size,
    salesTarget,
    salesAttainmentPct: salesTarget !== null ? pct(netSales, salesTarget) : null,
    collections,
    collectionTarget,
    collectionAttainmentPct: collectionTarget !== null ? pct(collections, collectionTarget) : null,
    outstanding: rec.outstanding,
    overdue: rec.overdue,
    overduePct: rec.overduePct,
    over90: rec.over90,
    invoicesRaised,
    invoicePaidRatioPct: pct(invoicesFullyPaid, invoicesRaised),
    invoiceValuePaidPct: pct(paidValue, invoicedValue),
    dso90,
    openComplaints,
    complaintsOpened: complaintsInPeriod.length,
    targetsAvailable,
  };
}
