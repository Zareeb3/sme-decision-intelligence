/**
 * Performance by dimension (region, channel, product category, product, customer)
 * with period-over-period comparison and contribution to change.
 *
 * "Contribution to change" = how much of the total change in net sales came
 * from each group. It explains WHERE the change happened, not WHY.
 */
import { previousPeriod } from "./dates";
import { filterOrders, type Filters } from "./filters";
import type { Model } from "./model";
import type { Order } from "../data/types";

export type Dimension = "region" | "channel" | "product_category" | "product" | "customer" | "customer_type";

export interface BreakdownRow {
  key: string;
  label: string;
  netSales: number;
  estGrossProfit: number;
  estGrossMarginPct: number | null;
  sharePct: number;
  volumeSqm: number;
  orders: number;
  avgDiscountPct: number | null;
  prevNetSales: number;
  changePct: number | null;
  /** This group's change as a share of the total absolute change (signed). */
  contributionToChange: number;
}

function keyOf(model: Model, o: Order, dim: Dimension): { key: string; label: string } {
  switch (dim) {
    case "region":
      return { key: o.region, label: o.region };
    case "channel":
      return { key: o.channel, label: o.channel };
    case "product_category":
      return { key: o.product_category, label: o.product_category };
    case "product":
      return { key: o.product_id, label: o.product_name };
    case "customer": {
      const c = model.customersById.get(o.customer_id);
      return { key: o.customer_id, label: c?.customer_name ?? o.customer_id };
    }
    case "customer_type": {
      const c = model.customersById.get(o.customer_id);
      return { key: c?.customer_type ?? "Unknown", label: c?.customer_type ?? "Unknown" };
    }
  }
}

interface Acc {
  key: string;
  label: string;
  netSales: number;
  cogs: number;
  gross: number;
  volume: number;
  orders: number;
}

function aggregate(model: Model, orders: Order[], dim: Dimension): Map<string, Acc> {
  const map = new Map<string, Acc>();
  for (const o of orders) {
    const { key, label } = keyOf(model, o, dim);
    const a = map.get(key) ?? { key, label, netSales: 0, cogs: 0, gross: 0, volume: 0, orders: 0 };
    a.netSales += o.net_sales_pkr;
    a.cogs += o.est_cogs_pkr;
    a.gross += o.quantity_sqm * o.list_price_per_sqm;
    a.volume += o.quantity_sqm;
    a.orders += 1;
    map.set(key, a);
  }
  return map;
}

export function breakdown(model: Model, f: Filters, dim: Dimension): BreakdownRow[] {
  const cur = aggregate(model, filterOrders(model, f), dim);
  const pp = previousPeriod(f.start, f.end);
  const prev = aggregate(model, filterOrders(model, { ...f, ...pp }), dim);

  const total = [...cur.values()].reduce((s, a) => s + a.netSales, 0);
  const prevTotal = [...prev.values()].reduce((s, a) => s + a.netSales, 0);
  const totalChange = total - prevTotal;

  const keys = new Set([...cur.keys(), ...prev.keys()]);
  const rows: BreakdownRow[] = [];
  for (const k of keys) {
    const a = cur.get(k);
    const p = prev.get(k);
    const netSales = a?.netSales ?? 0;
    const prevNetSales = p?.netSales ?? 0;
    const gp = netSales - (a?.cogs ?? 0);
    rows.push({
      key: k,
      label: a?.label ?? p?.label ?? k,
      netSales,
      estGrossProfit: gp,
      estGrossMarginPct: netSales > 0 ? (gp / netSales) * 100 : null,
      sharePct: total > 0 ? (netSales / total) * 100 : 0,
      volumeSqm: a?.volume ?? 0,
      orders: a?.orders ?? 0,
      avgDiscountPct: a && a.gross > 0 ? (1 - a.netSales / a.gross) * 100 : null,
      prevNetSales,
      changePct: prevNetSales > 0 ? ((netSales - prevNetSales) / prevNetSales) * 100 : null,
      contributionToChange: totalChange !== 0 ? (netSales - prevNetSales) / Math.abs(totalChange) : 0,
    });
  }
  return rows.sort((x, y) => y.netSales - x.netSales);
}
