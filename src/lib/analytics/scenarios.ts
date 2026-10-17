/**
 * Scenario ("what-if") calculations.
 *
 * Every scenario returns the baseline, the explicit assumptions, the
 * calculated outcome and the difference. These are arithmetic consequences of
 * stated assumptions — they are NOT predictions and do not say how likely the
 * assumption is.
 */
import { computeKpis, type KpiSet } from "./kpis";
import { breakdown } from "./breakdowns";
import { filterOrders, type Filters } from "./filters";
import type { Model } from "./model";

export interface ScenarioMetric {
  label: string;
  unit: "PKR" | "%" | "pts" | "days";
  baseline: number | null;
  scenario: number | null;
  difference: number | null;
}

export interface ScenarioResult {
  id: string;
  title: string;
  assumptions: string[];
  metrics: ScenarioMetric[];
  caveats: string[];
}

const metric = (label: string, unit: ScenarioMetric["unit"], baseline: number | null, scenario: number | null): ScenarioMetric => ({
  label,
  unit,
  baseline,
  scenario,
  difference: baseline !== null && scenario !== null ? scenario - baseline : null,
});

export const HYPOTHETICAL_NOTICE = "Hypothetical scenario: the result follows from the stated assumptions and is not a forecast or a guaranteed outcome.";

/** Collect an additional `pct`% of the overdue balance at the snapshot date. */
export function collectionUpliftScenario(model: Model, f: Filters, pct: number, kpis?: KpiSet): ScenarioResult {
  const k = kpis ?? computeKpis(model, f);
  const extra = (k.overdue * pct) / 100;
  const newColl = k.collections + extra;
  const newOverdue = k.overdue - extra;
  const newOutstanding = k.outstanding - extra;
  const dailySales = k.dso90 && k.dso90 > 0 ? k.outstanding / k.dso90 : null;
  return {
    id: "collection_uplift",
    title: `Collect an additional ${pct}% of overdue balances`,
    assumptions: [
      `${pct}% of the overdue balance on ${k.period.asOf} (PKR ${Math.round(k.overdue).toLocaleString("en-US")}) is collected within the period.`,
      "No change in sales, new invoices or other payments.",
      "The reduction is applied to total balances; which specific invoices get paid is not modelled.",
    ],
    metrics: [
      metric("Collections in period", "PKR", k.collections, newColl),
      metric("Collection target attainment", "%", k.collectionAttainmentPct, k.collectionTarget ? (newColl / k.collectionTarget) * 100 : null),
      metric("Overdue balance", "PKR", k.overdue, newOverdue),
      metric("Outstanding receivables", "PKR", k.outstanding, newOutstanding),
      metric("Overdue share of outstanding", "%", k.overduePct, newOutstanding > 0 ? (newOverdue / newOutstanding) * 100 : null),
      metric("Simple DSO (90-day)", "days", k.dso90, dailySales ? newOutstanding / dailySales : null),
    ],
    caveats: [HYPOTHETICAL_NOTICE, "Whether this collection is achievable depends on customer liquidity and follow-up effort, which the data does not show."],
  };
}

/** Change the sales target by `pct`%. */
export function targetChangeScenario(model: Model, f: Filters, pct: number, kpis?: KpiSet): ScenarioResult {
  const k = kpis ?? computeKpis(model, f);
  const newTarget = k.salesTarget !== null ? k.salesTarget * (1 + pct / 100) : null;
  return {
    id: "target_change",
    title: `Sales target ${pct >= 0 ? "raised" : "lowered"} by ${Math.abs(pct)}%`,
    assumptions: [`The sales target for the period is multiplied by ${(1 + pct / 100).toFixed(2)}.`, "Actual sales are unchanged."],
    metrics: [
      metric("Sales target", "PKR", k.salesTarget, newTarget),
      metric("Net sales (actual)", "PKR", k.netSales, k.netSales),
      metric("Target attainment", "%", k.salesAttainmentPct, newTarget ? (k.netSales / newTarget) * 100 : null),
      metric("Gap to target (actual − target)", "PKR", k.salesTarget !== null ? k.netSales - k.salesTarget : null, newTarget !== null ? k.netSales - newTarget : null),
    ],
    caveats: k.targetsAvailable
      ? [HYPOTHETICAL_NOTICE]
      : [HYPOTHETICAL_NOTICE, "Targets are set by region and month, so this scenario is unavailable while a channel or product filter is active."],
  };
}

/**
 * Change estimated unit costs by `costPct`% and discounts by `discountPts`
 * percentage points, holding volume and list prices constant.
 */
export function costDiscountScenario(model: Model, f: Filters, costPct: number, discountPts: number): ScenarioResult {
  const orders = filterOrders(model, f);
  let ns = 0;
  let cogs = 0;
  let newNs = 0;
  let newCogs = 0;
  for (const o of orders) {
    const gross = o.quantity_sqm * o.list_price_per_sqm;
    ns += o.net_sales_pkr;
    cogs += o.est_cogs_pkr;
    const newDisc = Math.min(100, Math.max(0, o.discount_pct + discountPts));
    // keep the recorded net sales as the baseline; apply the discount change to gross value
    newNs += o.net_sales_pkr - (gross * (newDisc - o.discount_pct)) / 100;
    newCogs += o.est_cogs_pkr * (1 + costPct / 100);
  }
  const gp = ns - cogs;
  const newGp = newNs - newCogs;
  return {
    id: "cost_discount",
    title: "Cost and discount change",
    assumptions: [
      `Estimated unit costs change by ${costPct >= 0 ? "+" : ""}${costPct}%.`,
      `Average discount changes by ${discountPts >= 0 ? "+" : ""}${discountPts} percentage points on every order (floored at 0%).`,
      "Volumes and list prices stay the same — in reality, discount changes usually affect volume.",
    ],
    metrics: [
      metric("Net sales", "PKR", ns, newNs),
      metric("Estimated COGS", "PKR", cogs, newCogs),
      metric("Estimated gross profit", "PKR", gp, newGp),
      metric("Estimated gross margin", "%", ns > 0 ? (gp / ns) * 100 : null, newNs > 0 ? (newGp / newNs) * 100 : null),
    ],
    caveats: [HYPOTHETICAL_NOTICE, "Costs are estimated standard costs, not audited product costs."],
  };
}

/**
 * Shift `sharePct`% of net sales from one product category (or channel) to
 * another, assuming each group keeps its current average margin.
 */
export function mixShiftScenario(
  model: Model,
  f: Filters,
  dim: "product_category" | "channel",
  from: string,
  to: string,
  sharePct: number,
): ScenarioResult {
  const rows = breakdown(model, f, dim);
  const src = rows.find((r) => r.key === from);
  const dst = rows.find((r) => r.key === to);
  const ns = rows.reduce((s, r) => s + r.netSales, 0);
  const gp = rows.reduce((s, r) => s + r.estGrossProfit, 0);
  const moved = src ? (src.netSales * sharePct) / 100 : 0;
  const srcM = src?.estGrossMarginPct ?? 0;
  const dstM = dst?.estGrossMarginPct ?? 0;
  const newGp = gp - (moved * srcM) / 100 + (moved * dstM) / 100;
  const dimLabel = dim === "channel" ? "channel" : "product category";
  return {
    id: "mix_shift",
    title: `Shift ${sharePct}% of ${from} sales to ${to}`,
    assumptions: [
      `${sharePct}% of ${from} net sales (PKR ${Math.round(moved).toLocaleString("en-US")}) is replaced by the same value of ${to} sales.`,
      `Each ${dimLabel} keeps its current estimated margin: ${from} ${srcM.toFixed(1)}%, ${to} ${dstM.toFixed(1)}%.`,
      "Total net sales are unchanged.",
    ],
    metrics: [
      metric("Net sales", "PKR", ns, ns),
      metric("Estimated gross profit", "PKR", gp, newGp),
      metric("Estimated gross margin", "%", ns > 0 ? (gp / ns) * 100 : null, ns > 0 ? (newGp / ns) * 100 : null),
      metric(`${from} net sales`, "PKR", src?.netSales ?? 0, (src?.netSales ?? 0) - moved),
      metric(`${to} net sales`, "PKR", dst?.netSales ?? 0, (dst?.netSales ?? 0) + moved),
    ],
    caveats: [
      HYPOTHETICAL_NOTICE,
      ...(src && dst ? [] : ["One of the selected groups has no sales in the period, so the shift has no effect."]),
      "Capacity, availability and customer demand for the target group are not modelled.",
    ],
  };
}
