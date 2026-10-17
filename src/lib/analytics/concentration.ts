/**
 * Customer revenue concentration: how dependent is the business on a few accounts?
 *
 * - Top-N share: % of net sales from the N largest customers.
 * - Pareto count: how many customers make up 80% of net sales.
 * - HHI (Herfindahl–Hirschman Index): sum of squared percentage shares (0–10,000).
 *   Commonly read as: < 1,500 unconcentrated, 1,500–2,500 moderate, > 2,500 high.
 *   Those cut-offs come from market-competition analysis; we use them only as a
 *   rough reference for customer dependence.
 */
import { filterOrders, type Filters } from "./filters";
import type { Model } from "./model";

export interface ConcentrationResult {
  customers: number;
  totalNetSales: number;
  top1SharePct: number;
  top5SharePct: number;
  top10SharePct: number;
  /** Number of customers that together make up 80% of net sales. */
  customersFor80Pct: number;
  hhi: number;
  ranked: { customer_id: string; customer_name: string; customer_type: string; region: string; netSales: number; sharePct: number; cumulativePct: number }[];
}

export function customerConcentration(model: Model, f: Filters): ConcentrationResult {
  const sales = new Map<string, number>();
  for (const o of filterOrders(model, f)) sales.set(o.customer_id, (sales.get(o.customer_id) ?? 0) + o.net_sales_pkr);
  const total = [...sales.values()].reduce((s, v) => s + v, 0);
  const sorted = [...sales.entries()].sort((a, b) => b[1] - a[1]);

  let cum = 0;
  let for80 = 0;
  const ranked = sorted.map(([id, v]) => {
    const c = model.customersById.get(id);
    const share = total > 0 ? (v / total) * 100 : 0;
    cum += share;
    if (cum - share < 80) for80 += 1;
    return {
      customer_id: id,
      customer_name: c?.customer_name ?? id,
      customer_type: c?.customer_type ?? "Unknown",
      region: c?.region ?? "Unknown",
      netSales: v,
      sharePct: share,
      cumulativePct: cum,
    };
  });
  const topShare = (n: number) => ranked.slice(0, n).reduce((s, r) => s + r.sharePct, 0);
  return {
    customers: ranked.length,
    totalNetSales: total,
    top1SharePct: topShare(1),
    top5SharePct: topShare(5),
    top10SharePct: topShare(10),
    customersFor80Pct: total > 0 ? for80 : 0,
    hhi: ranked.reduce((s, r) => s + r.sharePct * r.sharePct, 0),
    ranked,
  };
}
