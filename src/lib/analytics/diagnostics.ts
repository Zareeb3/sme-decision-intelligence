/**
 * Diagnostic analysis: identify PLAUSIBLE contributors to a change.
 *
 * Example question: "Why did sales increase while collections fell behind?"
 * We can measure where sales grew, where collections lagged and whose
 * payments slowed down. We cannot prove causation from this data, so every
 * output here is phrased as a contributor to investigate, with the numbers
 * attached.
 */
import { daysBetween, inRange, previousPeriod } from "./dates";
import { breakdown, type BreakdownRow } from "./breakdowns";
import { filterInvoicesByDims, sumTargets, targetsApplicable, type Filters } from "./filters";
import { computeKpis, type KpiSet } from "./kpis";
import type { Model } from "./model";
import { receivablesByCustomer } from "./receivables";

export interface PaymentDelayRow {
  group: string;
  invoicesPaid: number;
  avgDaysAfterDue: number | null;
  prevAvgDaysAfterDue: number | null;
  changeDays: number | null;
}

export interface RegionCollectionRow {
  region: string;
  netSales: number;
  salesTarget: number | null;
  salesAttainmentPct: number | null;
  collections: number;
  collectionTarget: number | null;
  collectionAttainmentPct: number | null;
  collectionGap: number | null;
}

export interface OverdueMover {
  customer_id: string;
  customer_name: string;
  customer_type: string;
  region: string;
  overdueNow: number;
  overduePrev: number;
  change: number;
}

export interface SalesCollectionsDiagnosis {
  current: KpiSet;
  previous: KpiSet;
  previousPeriod: { start: string; end: string };
  salesChangePct: number | null;
  collectionsChangePct: number | null;
  collectionsToSalesPct: number | null;
  prevCollectionsToSalesPct: number | null;
  regionRows: RegionCollectionRow[];
  salesDriversByRegion: BreakdownRow[];
  salesDriversByChannel: BreakdownRow[];
  paymentDelayByRegionType: PaymentDelayRow[];
  overdueMovers: OverdueMover[];
}

const pctChange = (a: number, b: number) => (b > 0 ? ((a - b) / b) * 100 : null);

/** Average days paid after due date for invoices paid within [start, end], grouped. */
function paymentDelay(model: Model, f: Filters, start: string, end: string, keyFn: (i: { region: string; customer_type: string }) => string) {
  const m = new Map<string, { n: number; days: number }>();
  for (const inv of filterInvoicesByDims(model, f)) {
    if (!inv.payment_date || !inRange(inv.payment_date, start, end)) continue;
    const k = keyFn(inv);
    const a = m.get(k) ?? { n: 0, days: 0 };
    a.n += 1;
    a.days += daysBetween(inv.due_date, inv.payment_date);
    m.set(k, a);
  }
  return m;
}

export function diagnoseSalesVsCollections(model: Model, f: Filters): SalesCollectionsDiagnosis {
  const pp = previousPeriod(f.start, f.end);
  const pf = { ...f, ...pp };
  const current = computeKpis(model, f);
  const previous = computeKpis(model, pf);

  // Region-level sales and collections vs targets
  const regions = f.regions.length ? f.regions : model.regions;
  const regionRows: RegionCollectionRow[] = regions.map((r) => {
    const rf = { ...f, regions: [r] };
    const k = computeKpis(model, rf);
    const withTargets = targetsApplicable(rf) && model.bundle.targets.length > 0;
    const st = withTargets ? sumTargets(model.bundle.targets, rf, "sales_target_pkr") : null;
    const ct = withTargets ? sumTargets(model.bundle.targets, rf, "collection_target_pkr") : null;
    return {
      region: r,
      netSales: k.netSales,
      salesTarget: st,
      salesAttainmentPct: st ? (k.netSales / st) * 100 : null,
      collections: k.collections,
      collectionTarget: ct,
      collectionAttainmentPct: ct ? (k.collections / ct) * 100 : null,
      collectionGap: ct !== null ? k.collections - ct : null,
    };
  });
  regionRows.sort((a, b) => (a.collectionGap ?? 0) - (b.collectionGap ?? 0));

  // Payment behaviour: region × customer type
  const key = (i: { region: string; customer_type: string }) => `${i.region} / ${i.customer_type}`;
  const cur = paymentDelay(model, f, f.start, f.end, key);
  const prev = paymentDelay(model, f, pp.start, pp.end, key);
  const paymentDelayByRegionType: PaymentDelayRow[] = [...new Set([...cur.keys(), ...prev.keys()])]
    .map((g) => {
      const c = cur.get(g);
      const p = prev.get(g);
      const a = c && c.n ? c.days / c.n : null;
      const b = p && p.n ? p.days / p.n : null;
      return { group: g, invoicesPaid: c?.n ?? 0, avgDaysAfterDue: a, prevAvgDaysAfterDue: b, changeDays: a !== null && b !== null ? a - b : null };
    })
    .filter((r) => r.invoicesPaid >= 5)
    .sort((a, b) => (b.changeDays ?? -Infinity) - (a.changeDays ?? -Infinity));

  // Who drove the overdue increase?
  const nowRows = receivablesByCustomer(model, f, current.period.asOf);
  const prevRows = new Map(receivablesByCustomer(model, f, previous.period.asOf).map((r) => [r.customer_id, r]));
  const ids = new Set([...nowRows.map((r) => r.customer_id), ...prevRows.keys()]);
  const nowMap = new Map(nowRows.map((r) => [r.customer_id, r]));
  const overdueMovers: OverdueMover[] = [...ids]
    .map((id) => {
      const n = nowMap.get(id);
      const p = prevRows.get(id);
      const ref = n ?? p!;
      return {
        customer_id: id,
        customer_name: ref.customer_name,
        customer_type: ref.customer_type,
        region: ref.region,
        overdueNow: n?.overdue ?? 0,
        overduePrev: p?.overdue ?? 0,
        change: (n?.overdue ?? 0) - (p?.overdue ?? 0),
      };
    })
    .sort((a, b) => b.change - a.change)
    .slice(0, 10);

  return {
    current,
    previous,
    previousPeriod: pp,
    salesChangePct: pctChange(current.netSales, previous.netSales),
    collectionsChangePct: pctChange(current.collections, previous.collections),
    collectionsToSalesPct: current.netSales > 0 ? (current.collections / current.netSales) * 100 : null,
    prevCollectionsToSalesPct: previous.netSales > 0 ? (previous.collections / previous.netSales) * 100 : null,
    regionRows,
    salesDriversByRegion: breakdown(model, f, "region"),
    salesDriversByChannel: breakdown(model, f, "channel"),
    paymentDelayByRegionType,
    overdueMovers,
  };
}
