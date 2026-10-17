/**
 * Product performance with transparent flags:
 *  - Declining: net sales down more than 15% vs the previous equal-length period
 *    (only when the previous period had meaningful sales).
 *  - Weak margin: estimated gross margin more than 5 points below the portfolio.
 *  - Margin erosion: margin down more than 3 points vs the previous period.
 * Thresholds are business assumptions, shown in the UI next to each flag.
 */
import { previousPeriod } from "./dates";
import { breakdown, type BreakdownRow } from "./breakdowns";
import { filterOrders, type Filters } from "./filters";
import type { Model } from "./model";

export interface ProductRow extends BreakdownRow {
  category: string;
  prevMarginPct: number | null;
  marginChangePts: number | null;
  flags: string[];
}

export const PRODUCT_FLAG_RULES = {
  decliningPct: -15,
  minPrevShareForDecline: 1, // % of previous-period sales
  weakMarginGapPts: 5,
  marginErosionPts: -3,
};

export function productPerformance(model: Model, f: Filters): { rows: ProductRow[]; portfolioMarginPct: number | null } {
  const rows = breakdown(model, f, "product");
  const pp = previousPeriod(f.start, f.end);
  const prevOrders = filterOrders(model, { ...f, ...pp });
  const prevAgg = new Map<string, { ns: number; cogs: number }>();
  let prevTotal = 0;
  for (const o of prevOrders) {
    const a = prevAgg.get(o.product_id) ?? { ns: 0, cogs: 0 };
    a.ns += o.net_sales_pkr;
    a.cogs += o.est_cogs_pkr;
    prevAgg.set(o.product_id, a);
    prevTotal += o.net_sales_pkr;
  }
  const totNs = rows.reduce((s, r) => s + r.netSales, 0);
  const totGp = rows.reduce((s, r) => s + r.estGrossProfit, 0);
  const portfolioMarginPct = totNs > 0 ? (totGp / totNs) * 100 : null;
  const R = PRODUCT_FLAG_RULES;

  const out: ProductRow[] = rows.map((r) => {
    const p = prevAgg.get(r.key);
    const prevMarginPct = p && p.ns > 0 ? ((p.ns - p.cogs) / p.ns) * 100 : null;
    const marginChangePts = r.estGrossMarginPct !== null && prevMarginPct !== null ? r.estGrossMarginPct - prevMarginPct : null;
    const flags: string[] = [];
    const prevShare = prevTotal > 0 ? (r.prevNetSales / prevTotal) * 100 : 0;
    if (r.changePct !== null && r.changePct < R.decliningPct && prevShare >= R.minPrevShareForDecline)
      flags.push(`Sales down ${Math.abs(r.changePct).toFixed(0)}% vs previous period`);
    if (r.estGrossMarginPct !== null && portfolioMarginPct !== null && r.estGrossMarginPct < portfolioMarginPct - R.weakMarginGapPts)
      flags.push(`Margin ${(portfolioMarginPct - r.estGrossMarginPct).toFixed(1)} pts below portfolio`);
    if (marginChangePts !== null && marginChangePts < R.marginErosionPts)
      flags.push(`Margin down ${Math.abs(marginChangePts).toFixed(1)} pts vs previous period`);
    return { ...r, category: model.productsById.get(r.key)?.product_category ?? "", prevMarginPct, marginChangePts, flags };
  });
  return { rows: out, portfolioMarginPct };
}
