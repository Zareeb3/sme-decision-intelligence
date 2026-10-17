import { describe, expect, it } from "vitest";
import { buildModel } from "../src/lib/analytics/model";
import { customerProfiles } from "../src/lib/analytics/customers";
import { median, modifiedZ, detectSalesAnomalies } from "../src/lib/analytics/anomalies";
import { backtestAndForecast, forecastNext } from "../src/lib/analytics/forecast";
import { complaintSummary } from "../src/lib/analytics/complaints";
import { productPerformance } from "../src/lib/analytics/products";
import { diagnoseSalesVsCollections } from "../src/lib/analytics/diagnostics";
import { defaultFilters } from "../src/lib/analytics/filters";
import { filters, Q1_2026, sampleBundle, tinyBundle } from "./fixtures";

describe("account health score (rule-based)", () => {
  it("explains every deduction with evidence", () => {
    const b = tinyBundle();
    // extend the data to 30 Jun with an unrelated order so the snapshot can move forward
    b.orders.push({ ...b.orders[0], order_id: "O5", order_date: "2026-06-30" });
    const model = buildModel(b);
    // At 30 Jun, C2's 60,000 is 105 days overdue and C2 has not ordered since 15 Feb.
    const p = customerProfiles(model, filters({ end: "2026-06-30" })).find((x) => x.customer_id === "C2")!;
    const rules = p.deductions.map((d) => d.rule);
    expect(rules).toContain("Overdue share"); // 100% overdue
    expect(rules).toContain("Oldest overdue"); // 105 days
    expect(rules).toContain("Order recency"); // 135 days since last order
    expect(rules).toContain("Open high-severity complaints");
    expect(p.healthScore).toBe(100 - p.deductions.reduce((s, d) => s + d.points, 0));
    expect(p.healthBand).toBe("Needs attention");
    for (const d of p.deductions) expect(d.evidence.length).toBeGreaterThan(5);
  });

  it("does not score customers with too little history", () => {
    const b = tinyBundle();
    b.invoices = b.invoices.filter((i) => i.customer_id !== "C2");
    const p = customerProfiles(buildModel(b), Q1_2026).find((x) => x.customer_id === "C2")!;
    expect(p.healthScore).toBeNull();
    expect(p.healthBand).toBe("Insufficient data");
  });

  it("produces a spread of bands on the sample data rather than flagging everyone", () => {
    const model = buildModel(sampleBundle());
    const profiles = customerProfiles(model, defaultFilters(model));
    const healthy = profiles.filter((p) => p.healthBand === "Healthy").length;
    const attention = profiles.filter((p) => p.healthBand === "Needs attention").length;
    expect(healthy).toBeGreaterThan(profiles.length * 0.3);
    expect(attention).toBeLessThan(profiles.length * 0.4);
  });
});

describe("anomaly detection (modified z-score)", () => {
  it("computes the median", () => {
    expect(median([3, 1, 2])).toBe(2);
    expect(median([4, 1, 2, 3])).toBe(2.5);
  });
  it("flags a clear outlier and ignores normal variation", () => {
    const base = [100, 102, 98, 101, 99, 103, 97, 100];
    expect(Math.abs(modifiedZ(100, base)!)).toBeLessThan(1);
    expect(modifiedZ(200, base)!).toBeGreaterThan(3.5);
  });
  it("refuses to score with too little history or zero spread", () => {
    expect(modifiedZ(5, [1, 2, 3])).toBeNull();
    expect(modifiedZ(5, [1, 1, 1, 1, 1, 1, 1])).toBeNull();
  });
  it("returns anomalies with direction and baseline on the sample data", () => {
    const model = buildModel(sampleBundle());
    const a = detectSalesAnomalies(model, defaultFilters(model));
    for (const x of a) {
      expect(Math.abs(x.z)).toBeGreaterThan(3.5);
      expect(x.direction).toBe(x.value > x.baselineMedian ? "above" : "below");
    }
  });
});

describe("forecast baselines", () => {
  it("implements each baseline method", () => {
    const h = Array.from({ length: 24 }, (_, i) => 100 + i);
    expect(forecastNext(h, "naive")).toBe(123);
    expect(forecastNext(h, "moving_average_3")).toBe(122);
    expect(forecastNext(h, "seasonal_naive")).toBe(112);
    const last12 = h.slice(12).reduce((a, b) => a + b, 0);
    const prev12 = h.slice(0, 12).reduce((a, b) => a + b, 0);
    expect(forecastNext(h, "seasonal_trend")).toBeCloseTo(112 * (last12 / prev12), 9);
    expect(forecastNext(h.slice(0, 5), "seasonal_naive")).toBeNull();
  });

  it("refuses to forecast with insufficient history", () => {
    const r = backtestAndForecast(buildModel(tinyBundle()), Q1_2026);
    expect(r.sufficient).toBe(false);
    expect(r.reason).toContain("at least");
  });

  it("backtests every method on the sample data and picks the lowest error", () => {
    const model = buildModel(sampleBundle());
    const r = backtestAndForecast(model, defaultFilters(model));
    expect(r.sufficient).toBe(true);
    expect(r.scores).toHaveLength(4);
    const best = r.scores.find((s) => s.method === r.best)!;
    for (const s of r.scores) if (s.mapePct !== null && s.evaluatedMonths === 6) expect(best.mapePct!).toBeLessThanOrEqual(s.mapePct);
    expect(r.outlook).toHaveLength(3);
    for (const o of r.outlook) {
      expect(o.low).toBeLessThanOrEqual(o.forecast);
      expect(o.high).toBeGreaterThanOrEqual(o.forecast);
    }
  });
});

describe("complaints", () => {
  it("summarises open complaints by team on the fixture", () => {
    const s = complaintSummary(buildModel(tinyBundle()), Q1_2026);
    expect(s.openAtAsOf).toBe(1);
    expect(s.openHighSeverity).toBe(1);
    expect(s.avgResolutionDays).toBe(5);
    expect(s.byTeam.find((t) => t.key === "Quality")!.open).toBe(1);
  });

  it("detects the shade-variation spike built into the sample data", () => {
    const model = buildModel(sampleBundle());
    const s = complaintSummary(model, defaultFilters(model));
    const spike = s.spikes.find((x) => x.product_id === "P013");
    expect(spike).toBeDefined();
    expect(spike!.topCategory).toBe("Shade Variation");
  });
});

describe("product performance", () => {
  it("flags the margin-squeezed porcelain SKU in the sample data", () => {
    const model = buildModel(sampleBundle());
    const r = productPerformance(model, defaultFilters(model));
    const p009 = r.rows.find((x) => x.key === "P009")!;
    expect(p009.flags.some((f) => f.includes("below portfolio"))).toBe(true);
  });
});

describe("sales vs collections diagnosis on the sample data (Q3 2026)", () => {
  const model = buildModel(sampleBundle());
  const d = diagnoseSalesVsCollections(model, defaultFilters(model));

  it("shows sales above target while collections are below target", () => {
    expect(d.current.salesAttainmentPct!).toBeGreaterThan(100);
    expect(d.current.collectionAttainmentPct!).toBeLessThan(100);
  });

  it("identifies South as the region with the largest collection gap", () => {
    expect(d.regionRows[0].region).toBe("South");
    expect(d.regionRows[0].collectionGap!).toBeLessThan(0);
  });

  it("lists customers whose overdue balance grew most", () => {
    expect(d.overdueMovers.length).toBeGreaterThan(0);
    expect(d.overdueMovers[0].change).toBeGreaterThan(0);
  });
});

import { attentionInsights } from "../src/lib/analytics/insights";

describe("overview attention insights", () => {
  const model = buildModel(sampleBundle());
  const insights = attentionInsights(model, defaultFilters(model));

  it("surfaces the sales-collections gap and the complaint spike in the sample data", () => {
    const ids = insights.map((i) => i.id);
    expect(ids).toContain("sales-collections-gap");
    expect(ids).toContain("complaint-spike-P013");
  });

  it("answers what, why, evidence and next step for every finding", () => {
    for (const i of insights) {
      expect(i.what.length).toBeGreaterThan(10);
      expect(i.why.length).toBeGreaterThan(10);
      expect(i.evidence.length).toBeGreaterThan(0);
      expect(i.next.length).toBeGreaterThan(10);
    }
  });

  it("orders findings by severity", () => {
    const rank = { high: 0, medium: 1, info: 2 };
    const ranks = insights.map((i) => rank[i.severity]);
    expect([...ranks].sort((a, b) => a - b)).toEqual(ranks);
  });
});
