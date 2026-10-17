/**
 * Statistical detection of unusual months.
 *
 * Method: modified z-score (Iglewicz & Hoaglin, 1993). For each month in the
 * selected period we compare the value with the previous 12 months using the
 * median and the median absolute deviation (MAD), which are not distorted by
 * a single extreme month the way a mean and standard deviation are.
 *
 *     z = 0.6745 × (x − median) / MAD          flag when |z| > 3.5
 *
 * A flag means "statistically unusual compared with its own recent history".
 * It does not explain the cause and is not a forecast.
 */
import { addMonths, monthKey, monthsBetween } from "./dates";
import { matchesDims, type Filters } from "./filters";
import type { Model } from "./model";

export const ANOMALY_THRESHOLD = 3.5;
export const MIN_BASELINE_MONTHS = 6;

export function median(xs: number[]): number {
  if (xs.length === 0) return NaN;
  const s = [...xs].sort((a, b) => a - b);
  const mid = Math.floor(s.length / 2);
  return s.length % 2 ? s[mid] : (s[mid - 1] + s[mid]) / 2;
}

export function modifiedZ(x: number, baseline: number[]): number | null {
  if (baseline.length < MIN_BASELINE_MONTHS) return null;
  const med = median(baseline);
  const mad = median(baseline.map((v) => Math.abs(v - med)));
  if (mad === 0) return null;
  return (0.6745 * (x - med)) / mad;
}

export interface Anomaly {
  dimension: "product" | "region";
  key: string;
  label: string;
  month: string;
  value: number;
  baselineMedian: number;
  z: number;
  direction: "above" | "below";
}

export function detectSalesAnomalies(model: Model, f: Filters): Anomaly[] {
  const months = monthsBetween(f.start, f.end);
  if (months.length === 0) return [];
  const firstBaseline = addMonths(months[0], -12);
  const allMonths = monthsBetween(`${firstBaseline}-01`, f.end);
  const idx = new Map(allMonths.map((m, i) => [m, i]));

  const series = new Map<string, { dimension: "product" | "region"; key: string; label: string; values: number[] }>();
  const add = (dimension: "product" | "region", key: string, label: string, i: number, v: number) => {
    const id = `${dimension}:${key}`;
    let s = series.get(id);
    if (!s) {
      s = { dimension, key, label, values: new Array(allMonths.length).fill(0) };
      series.set(id, s);
    }
    s.values[i] += v;
  };
  for (const o of model.orders) {
    if (o.order_date > f.end || !matchesDims(f, o)) continue;
    const i = idx.get(monthKey(o.order_date));
    if (i === undefined) continue;
    add("product", o.product_id, o.product_name, i, o.net_sales_pkr);
    add("region", o.region, o.region, i, o.net_sales_pkr);
  }

  const minDataMonth = monthKey(model.minDate);
  const out: Anomaly[] = [];
  for (const s of series.values()) {
    for (const m of months) {
      const i = idx.get(m)!;
      const baselineMonths = allMonths.slice(Math.max(0, i - 12), i).filter((bm) => bm >= minDataMonth);
      const baseline = baselineMonths.map((bm) => s.values[idx.get(bm)!]);
      const z = modifiedZ(s.values[i], baseline);
      if (z !== null && Math.abs(z) > ANOMALY_THRESHOLD) {
        out.push({
          dimension: s.dimension,
          key: s.key,
          label: s.label,
          month: m,
          value: s.values[i],
          baselineMedian: median(baseline),
          z,
          direction: z > 0 ? "above" : "below",
        });
      }
    }
  }
  return out.sort((a, b) => Math.abs(b.z) - Math.abs(a.z));
}
