/**
 * Monthly and quarterly time series for charts and diagnostics.
 */
import { fiscalQuarterKey, inRange, monthKey, monthsBetween } from "./dates";
import { getSettings } from "../settings";
import { filterInvoicesByDims, filterOrders, sumTargets, targetsApplicable, type Filters } from "./filters";
import { monthEnd, monthStart } from "./dates";
import type { Model } from "./model";

export interface PeriodPoint {
  period: string;
  netSales: number;
  estGrossProfit: number;
  estGrossMarginPct: number | null;
  collections: number;
  salesTarget: number | null;
  collectionTarget: number | null;
  orders: number;
}

export function monthlySeries(model: Model, f: Filters): PeriodPoint[] {
  const months = monthsBetween(f.start, f.end);
  const map = new Map<string, PeriodPoint>(
    months.map((m) => [
      m,
      { period: m, netSales: 0, estGrossProfit: 0, estGrossMarginPct: null, collections: 0, salesTarget: null, collectionTarget: null, orders: 0 },
    ]),
  );
  for (const o of filterOrders(model, f)) {
    const p = map.get(monthKey(o.order_date));
    if (!p) continue;
    p.netSales += o.net_sales_pkr;
    p.estGrossProfit += o.net_sales_pkr - o.est_cogs_pkr;
    if (o.order_status === "Delivered") p.orders += 1;
  }
  for (const inv of filterInvoicesByDims(model, f)) {
    for (const pay of inv.payments) {
      if (pay.type !== "Payment" || !inRange(pay.date, f.start, f.end)) continue;
      const p = map.get(monthKey(pay.date));
      if (p) p.collections += pay.amount;
    }
  }
  const withTargets = targetsApplicable(f) && model.bundle.targets.length > 0;
  for (const p of map.values()) {
    p.estGrossMarginPct = p.netSales > 0 ? (p.estGrossProfit / p.netSales) * 100 : null;
    if (withTargets) {
      // clip the month to the filter window so partial months are pro-rated consistently with KPIs
      const s = monthStart(p.period) < f.start ? f.start : monthStart(p.period);
      const e = monthEnd(p.period) > f.end ? f.end : monthEnd(p.period);
      const mf = { ...f, start: s, end: e };
      p.salesTarget = sumTargets(model.bundle.targets, mf, "sales_target_pkr");
      p.collectionTarget = sumTargets(model.bundle.targets, mf, "collection_target_pkr");
    }
  }
  return [...map.values()];
}

export function quarterlySeries(model: Model, f: Filters): PeriodPoint[] {
  const out = new Map<string, PeriodPoint>();
  for (const m of monthlySeries(model, f)) {
    const q = fiscalQuarterKey(`${m.period}-01`, getSettings().fiscalYearStartMonth);
    const p = out.get(q) ?? {
      period: q,
      netSales: 0,
      estGrossProfit: 0,
      estGrossMarginPct: null,
      collections: 0,
      salesTarget: m.salesTarget === null ? null : 0,
      collectionTarget: m.collectionTarget === null ? null : 0,
      orders: 0,
    };
    p.netSales += m.netSales;
    p.estGrossProfit += m.estGrossProfit;
    p.collections += m.collections;
    p.orders += m.orders;
    if (p.salesTarget !== null && m.salesTarget !== null) p.salesTarget += m.salesTarget;
    if (p.collectionTarget !== null && m.collectionTarget !== null) p.collectionTarget += m.collectionTarget;
    out.set(q, p);
  }
  for (const p of out.values()) p.estGrossMarginPct = p.netSales > 0 ? (p.estGrossProfit / p.netSales) * 100 : null;
  return [...out.values()];
}
