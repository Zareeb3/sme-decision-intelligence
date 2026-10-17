import { describe, expect, it } from "vitest";
import { buildModel } from "../src/lib/analytics/model";
import { computeKpis } from "../src/lib/analytics/kpis";
import { monthlySeries, quarterlySeries } from "../src/lib/analytics/trends";
import { filters, Q1_2026, tinyBundle } from "./fixtures";

describe("computeKpis on the hand-built fixture (Q1 2026)", () => {
  const model = buildModel(tinyBundle());
  const k = computeKpis(model, Q1_2026);

  it("sums net sales of delivered orders only (cancelled O3 excluded)", () => {
    expect(k.netSales).toBe(228_000);
    expect(k.orderCount).toBe(3);
  });

  it("computes estimated gross profit and margin", () => {
    expect(k.estCogs).toBe(130_000);
    expect(k.estGrossProfit).toBe(98_000);
    expect(k.estGrossMarginPct).toBeCloseTo((98_000 / 228_000) * 100, 6);
  });

  it("computes value-weighted average discount", () => {
    // gross = 100,000 + 100,000 + 40,000 = 240,000; net 228,000 -> 5%
    expect(k.avgDiscountPct).toBeCloseTo(5, 6);
  });

  it("counts collections by payment date", () => {
    expect(k.collections).toBe(130_000); // I1 90,000 on 20 Mar + I2 40,000 on 31 Mar
  });

  it("matches sales and collection targets for the period", () => {
    expect(k.salesTarget).toBe(330_000);
    expect(k.salesAttainmentPct).toBeCloseTo((228_000 / 330_000) * 100, 6);
    expect(k.collectionTarget).toBe(210_000);
    expect(k.collectionAttainmentPct).toBeCloseTo((130_000 / 210_000) * 100, 6);
  });

  it("computes outstanding and overdue as of the period end", () => {
    expect(k.period.asOf).toBe("2026-03-31");
    expect(k.outstanding).toBe(98_000); // I2 60,000 + I4 38,000
    expect(k.overdue).toBe(60_000); // I2 is 14 days past due
    expect(k.overduePct).toBeCloseTo((60_000 / 98_000) * 100, 6);
  });

  it("computes the invoice paid ratio (count and value)", () => {
    expect(k.invoicesRaised).toBe(3);
    expect(k.invoicePaidRatioPct).toBeCloseTo(100 / 3, 6);
    expect(k.invoiceValuePaidPct).toBeCloseTo((130_000 / 228_000) * 100, 6);
  });

  it("counts open complaints at the snapshot date", () => {
    expect(k.openComplaints).toBe(1);
    expect(k.complaintsOpened).toBe(2);
  });

  it("counts active customers", () => {
    expect(k.activeCustomers).toBe(2);
  });
});

describe("as-of reconstruction of receivables", () => {
  const model = buildModel(tinyBundle());

  it("treats payments made after the snapshot date as unpaid", () => {
    const k = computeKpis(model, filters({ end: "2026-02-28" }));
    expect(k.period.asOf).toBe("2026-02-28");
    expect(k.collections).toBe(0);
    expect(k.outstanding).toBe(190_000); // I1 90,000 + I2 100,000 (both unpaid on 28 Feb)
    expect(k.overdue).toBe(0); // neither due yet
  });

  it("caps the snapshot date at the last date in the data", () => {
    const k = computeKpis(model, filters({ end: "2027-12-31" }));
    expect(k.period.asOf).toBe(model.maxDate);
  });
});

describe("target handling", () => {
  const model = buildModel(tinyBundle());

  it("hides target attainment when a channel filter is active", () => {
    const k = computeKpis(model, filters({ channels: ["Retail"] }));
    expect(k.targetsAvailable).toBe(false);
    expect(k.salesTarget).toBeNull();
    expect(k.salesAttainmentPct).toBeNull();
  });

  it("hides target attainment when a product filter is active", () => {
    const k = computeKpis(model, filters({ categories: ["Cat A"] }));
    expect(k.salesAttainmentPct).toBeNull();
  });

  it("pro-rates targets for partial months", () => {
    const k = computeKpis(model, filters({ start: "2026-01-01", end: "2026-01-15" }));
    expect(k.salesTarget).toBeCloseTo((110_000 * 15) / 31, 6);
  });

  it("uses only the filtered region's targets", () => {
    const k = computeKpis(model, filters({ regions: ["South"] }));
    expect(k.salesTarget).toBe(150_000);
  });
});

describe("time series", () => {
  const model = buildModel(tinyBundle());
  it("builds a monthly series that adds up to the period KPIs", () => {
    const s = monthlySeries(model, Q1_2026);
    expect(s.map((p) => p.period)).toEqual(["2026-01", "2026-02", "2026-03"]);
    expect(s.map((p) => p.netSales)).toEqual([90_000, 100_000, 38_000]);
    expect(s.reduce((a, p) => a + p.collections, 0)).toBe(130_000);
    expect(s[0].salesTarget).toBe(110_000);
  });
  it("rolls months up into quarters", () => {
    const q = quarterlySeries(model, Q1_2026);
    expect(q).toHaveLength(1);
    expect(q[0].period).toBe("2026-Q1");
    expect(q[0].netSales).toBe(228_000);
    expect(q[0].salesTarget).toBe(330_000);
  });
});

describe("empty and missing data", () => {
  it("returns zeros and nulls instead of NaN for an empty period", () => {
    const model = buildModel(tinyBundle());
    const k = computeKpis(model, filters({ start: "2025-01-01", end: "2025-01-31" }));
    expect(k.netSales).toBe(0);
    expect(k.estGrossMarginPct).toBeNull();
    expect(k.invoicePaidRatioPct).toBeNull();
    expect(k.avgDiscountPct).toBeNull();
  });

  it("handles a bundle with no targets or complaints", () => {
    const b = { ...tinyBundle(), targets: [], complaints: [] };
    const k = computeKpis(buildModel(b), Q1_2026);
    expect(k.targetsAvailable).toBe(false);
    expect(k.salesAttainmentPct).toBeNull();
    expect(k.openComplaints).toBe(0);
  });
});
