import { describe, expect, it } from "vitest";
import { buildModel } from "../src/lib/analytics/model";
import { customerConcentration } from "../src/lib/analytics/concentration";
import { breakdown } from "../src/lib/analytics/breakdowns";
import {
  collectionUpliftScenario,
  costDiscountScenario,
  mixShiftScenario,
  targetChangeScenario,
} from "../src/lib/analytics/scenarios";
import { filters, Q1_2026, tinyBundle } from "./fixtures";

const byLabel = (r: { metrics: { label: string; baseline: number | null; scenario: number | null; difference: number | null }[] }, label: string) =>
  r.metrics.find((m) => m.label === label)!;

describe("customer revenue concentration", () => {
  const model = buildModel(tinyBundle());
  const c = customerConcentration(model, Q1_2026);

  it("ranks customers and computes shares", () => {
    expect(c.ranked.map((r) => r.customer_id)).toEqual(["C1", "C2"]); // 128,000 vs 100,000
    expect(c.top1SharePct).toBeCloseTo((128_000 / 228_000) * 100, 6);
    expect(c.top5SharePct).toBeCloseTo(100, 6);
    expect(c.ranked[1].cumulativePct).toBeCloseTo(100, 6);
  });

  it("computes the HHI and the Pareto count", () => {
    const s1 = (128_000 / 228_000) * 100;
    const s2 = (100_000 / 228_000) * 100;
    expect(c.hhi).toBeCloseTo(s1 * s1 + s2 * s2, 6);
    expect(c.customersFor80Pct).toBe(2);
  });

  it("returns an empty, zero result when there are no sales", () => {
    const e = customerConcentration(model, filters({ start: "2025-01-01", end: "2025-01-31" }));
    expect(e.customers).toBe(0);
    expect(e.top5SharePct).toBe(0);
    expect(e.customersFor80Pct).toBe(0);
  });
});

describe("breakdowns", () => {
  const model = buildModel(tinyBundle());
  it("computes shares and period-over-period contribution", () => {
    const rows = breakdown(model, Q1_2026, "region");
    const south = rows.find((r) => r.key === "South")!;
    expect(south.netSales).toBe(128_000);
    expect(south.sharePct).toBeCloseTo((128_000 / 228_000) * 100, 6);
    expect(south.prevNetSales).toBe(0); // previous quarter has no data
    expect(south.changePct).toBeNull();
    expect(rows.reduce((s, r) => s + r.contributionToChange, 0)).toBeCloseTo(1, 6);
  });
});

describe("scenarios", () => {
  const model = buildModel(tinyBundle());

  it("collects an additional 10% of overdue balances", () => {
    const r = collectionUpliftScenario(model, Q1_2026, 10);
    expect(byLabel(r, "Collections in period")).toMatchObject({ baseline: 130_000, scenario: 136_000, difference: 6_000 });
    expect(byLabel(r, "Overdue balance")).toMatchObject({ baseline: 60_000, scenario: 54_000 });
    expect(byLabel(r, "Outstanding receivables").scenario).toBe(92_000);
    expect(byLabel(r, "Collection target attainment").scenario).toBeCloseTo((136_000 / 210_000) * 100, 6);
    expect(r.caveats[0]).toContain("Hypothetical");
  });

  it("changes the sales target", () => {
    const r = targetChangeScenario(model, Q1_2026, 10);
    expect(byLabel(r, "Sales target").scenario).toBeCloseTo(363_000, 6);
    expect(byLabel(r, "Target attainment").scenario).toBeCloseTo((228_000 / 363_000) * 100, 6);
    expect(byLabel(r, "Net sales (actual)").difference).toBe(0);
  });

  it("reports target scenarios as unavailable under a channel filter", () => {
    const r = targetChangeScenario(model, filters({ channels: ["Retail"] }), 10);
    expect(byLabel(r, "Sales target").scenario).toBeNull();
    expect(r.caveats.join(" ")).toContain("unavailable");
  });

  it("applies cost and discount changes holding volume constant", () => {
    const r = costDiscountScenario(model, Q1_2026, 10, 2);
    // net: 90,000-2,000 + 100,000-2,000 + 38,000-800 = 223,200; cogs 130,000*1.1 = 143,000
    expect(byLabel(r, "Net sales").scenario).toBeCloseTo(223_200, 6);
    expect(byLabel(r, "Estimated COGS").scenario).toBeCloseTo(143_000, 6);
    expect(byLabel(r, "Estimated gross profit").scenario).toBeCloseTo(80_200, 6);
    expect(byLabel(r, "Estimated gross profit").difference).toBeCloseTo(-17_800, 6);
  });

  it("returns the baseline unchanged for a zero-change scenario", () => {
    const r = costDiscountScenario(model, Q1_2026, 0, 0);
    for (const m of r.metrics) expect(m.difference).toBeCloseTo(0, 6);
  });

  it("shifts product mix at each group's current margin", () => {
    const r = mixShiftScenario(model, Q1_2026, "product_category", "Cat A", "Cat B", 10);
    // moved 9,000 from Cat A (33.33% margin) to Cat B (68,000/138,000 = 49.28% margin)
    const expected = 98_000 - 9_000 * (30_000 / 90_000) + 9_000 * (68_000 / 138_000);
    expect(byLabel(r, "Estimated gross profit").scenario).toBeCloseTo(expected, 6);
    expect(byLabel(r, "Net sales").difference).toBe(0);
  });
});
