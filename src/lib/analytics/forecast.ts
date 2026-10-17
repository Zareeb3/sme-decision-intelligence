/**
 * Baseline forecasting with honest evaluation.
 *
 * We do NOT fit a complex model: with under three years of monthly data that
 * would mostly fit noise. Instead we compare four simple, explainable methods
 * on a rolling backtest (each month in the holdout is forecast using only the
 * data before it), report their errors, and use the best one for a short
 * 3-month outlook.
 *
 *   naive            next month = last month
 *   moving average   next month = mean of last 3 months
 *   seasonal naive   next month = same month last year
 *   seasonal + trend seasonal naive × (last 12 months / previous 12 months)
 */
import { addMonths, monthEnd, monthKey, monthsBetween } from "./dates";
import { matchesDims, type Filters } from "./filters";
import type { Model } from "./model";

export type ForecastMethod = "naive" | "moving_average_3" | "seasonal_naive" | "seasonal_trend";

export const METHOD_LABELS: Record<ForecastMethod, string> = {
  naive: "Naive (last month)",
  moving_average_3: "3-month moving average",
  seasonal_naive: "Seasonal naive (same month last year)",
  seasonal_trend: "Seasonal naive × year-on-year trend",
};

const sum = (xs: number[]) => xs.reduce((s, v) => s + v, 0);

export function forecastNext(history: number[], method: ForecastMethod): number | null {
  const n = history.length;
  switch (method) {
    case "naive":
      return n >= 1 ? history[n - 1] : null;
    case "moving_average_3":
      return n >= 3 ? sum(history.slice(-3)) / 3 : null;
    case "seasonal_naive":
      return n >= 12 ? history[n - 12] : null;
    case "seasonal_trend": {
      if (n < 24) return null;
      const last12 = sum(history.slice(-12));
      const prev12 = sum(history.slice(-24, -12));
      return prev12 > 0 ? history[n - 12] * (last12 / prev12) : null;
    }
  }
}

export interface MethodScore {
  method: ForecastMethod;
  label: string;
  mae: number | null;
  mapePct: number | null;
  evaluatedMonths: number;
}

export interface ForecastResult {
  sufficient: boolean;
  reason?: string;
  history: { month: string; actual: number }[];
  holdoutMonths: number;
  scores: MethodScore[];
  best: ForecastMethod | null;
  outlook: { month: string; forecast: number; low: number; high: number }[];
  notes: string[];
}

export const MIN_HISTORY_MONTHS = 18;
export const HOLDOUT_MONTHS = 6;

export function monthlyNetSalesHistory(model: Model, f: Filters): { month: string; actual: number }[] {
  // Use complete months only, up to the end of the selected period.
  const lastMonth = monthKey(f.end < model.maxDate ? f.end : model.maxDate);
  const end = monthEnd(lastMonth) <= (f.end < model.maxDate ? f.end : model.maxDate) ? lastMonth : addMonths(lastMonth, -1);
  const months = monthsBetween(model.minDate, `${end}-01`);
  const idx = new Map(months.map((m, i) => [m, i]));
  const vals = new Array(months.length).fill(0);
  for (const o of model.orders) {
    if (!matchesDims(f, o)) continue;
    const i = idx.get(monthKey(o.order_date));
    if (i !== undefined) vals[i] += o.net_sales_pkr;
  }
  return months.map((m, i) => ({ month: m, actual: vals[i] }));
}

export function backtestAndForecast(model: Model, f: Filters, horizon = 3): ForecastResult {
  const history = monthlyNetSalesHistory(model, f);
  const values = history.map((h) => h.actual);
  const notes = [
    "Forecasts are statistical baselines from past sales only; they ignore planned price changes, campaigns, capacity and market events.",
    "The range is ± the largest monthly percentage error seen in the backtest. It is a rough guide, not a statistical confidence interval.",
  ];
  if (values.length < MIN_HISTORY_MONTHS) {
    return {
      sufficient: false,
      reason: `Forecasting needs at least ${MIN_HISTORY_MONTHS} complete months of history; ${values.length} available.`,
      history,
      holdoutMonths: 0,
      scores: [],
      best: null,
      outlook: [],
      notes,
    };
  }

  const methods: ForecastMethod[] = ["naive", "moving_average_3", "seasonal_naive", "seasonal_trend"];
  const errors = new Map<ForecastMethod, { abs: number[]; pct: number[] }>(methods.map((m) => [m, { abs: [], pct: [] }]));
  const holdoutStart = values.length - HOLDOUT_MONTHS;
  for (let t = holdoutStart; t < values.length; t++) {
    const train = values.slice(0, t);
    for (const m of methods) {
      const fc = forecastNext(train, m);
      if (fc === null) continue;
      const e = errors.get(m)!;
      e.abs.push(Math.abs(values[t] - fc));
      if (values[t] > 0) e.pct.push(((fc - values[t]) / values[t]) * 100);
    }
  }
  const scores: MethodScore[] = methods.map((m) => {
    const e = errors.get(m)!;
    return {
      method: m,
      label: METHOD_LABELS[m],
      mae: e.abs.length ? sum(e.abs) / e.abs.length : null,
      mapePct: e.pct.length ? sum(e.pct.map(Math.abs)) / e.pct.length : null,
      evaluatedMonths: e.abs.length,
    };
  });
  const eligible = scores.filter((s) => s.mapePct !== null && s.evaluatedMonths === HOLDOUT_MONTHS);
  const bestScore = eligible.sort((a, b) => a.mapePct! - b.mapePct!)[0];
  const best = bestScore?.method ?? null;

  const outlook: ForecastResult["outlook"] = [];
  if (best) {
    const pctErrs = errors.get(best)!.pct;
    const maxAbs = Math.max(...pctErrs.map(Math.abs));
    const meanErr = sum(pctErrs) / pctErrs.length;
    notes.push(
      `In the backtest the chosen method ${meanErr < 0 ? "under" : "over"}-forecast by ${Math.abs(meanErr).toFixed(1)}% on average; the largest monthly error was ${maxAbs.toFixed(1)}%.`,
    );
    const series = [...values];
    let month = history[history.length - 1].month;
    for (let h = 0; h < horizon; h++) {
      const fc = forecastNext(series, best)!;
      month = addMonths(month, 1);
      outlook.push({ month, forecast: fc, low: fc * (1 - maxAbs / 100), high: fc * (1 + maxAbs / 100) });
      series.push(fc); // recursive multi-step forecast
    }
  }
  if (history.length < 36) notes.push(`Only ${history.length} months of history: seasonal estimates rest on ${Math.floor(history.length / 12)} prior year(s).`);
  return { sufficient: true, history, holdoutMonths: HOLDOUT_MONTHS, scores, best, outlook, notes };
}
