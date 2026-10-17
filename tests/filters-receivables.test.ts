import { describe, expect, it } from "vitest";
import { addMonths, isValidIsoDate, monthsBetween, previousPeriod, quarterKey } from "../src/lib/analytics/dates";
import { buildModel } from "../src/lib/analytics/model";
import { defaultFilters, filterOrders } from "../src/lib/analytics/filters";
import { agingBucket, overdueByRegion, receivablesByCustomer, receivablesSnapshot } from "../src/lib/analytics/receivables";
import { computeKpis } from "../src/lib/analytics/kpis";
import { filters, Q1_2026, tinyBundle } from "./fixtures";

describe("date helpers", () => {
  it("validates real calendar dates", () => {
    expect(isValidIsoDate("2024-02-29")).toBe(true);
    expect(isValidIsoDate("2025-02-29")).toBe(false);
    expect(isValidIsoDate("2025-13-01")).toBe(false);
    expect(isValidIsoDate("25-01-01")).toBe(false);
  });
  it("computes the previous equal-length period in whole months", () => {
    expect(previousPeriod("2026-07-01", "2026-09-30")).toEqual({ start: "2026-04-01", end: "2026-06-30" });
    expect(previousPeriod("2026-01-01", "2026-12-31")).toEqual({ start: "2025-01-01", end: "2025-12-31" });
  });
  it("computes the previous period in days for partial months", () => {
    expect(previousPeriod("2026-03-10", "2026-03-19")).toEqual({ start: "2026-02-28", end: "2026-03-09" });
  });
  it("handles month arithmetic across years", () => {
    expect(addMonths("2026-01", -1)).toBe("2025-12");
    expect(monthsBetween("2025-11-15", "2026-02-01")).toEqual(["2025-11", "2025-12", "2026-01", "2026-02"]);
    expect(quarterKey("2026-09-30")).toBe("2026-Q3");
  });
});

describe("date and regional filtering", () => {
  const model = buildModel(tinyBundle());

  it("filters orders by inclusive date range", () => {
    expect(filterOrders(model, filters({ start: "2026-01-10", end: "2026-02-15" })).map((o) => o.order_id)).toEqual(["O1", "O2"]);
    expect(filterOrders(model, filters({ start: "2026-01-11", end: "2026-02-14" }))).toHaveLength(0);
  });

  it("applies the region filter to sales, collections and receivables consistently", () => {
    const k = computeKpis(model, filters({ regions: ["South"] }));
    expect(k.netSales).toBe(128_000); // O1 + O4
    expect(k.collections).toBe(90_000); // I1 only
    expect(k.outstanding).toBe(38_000); // I4
    expect(k.overdue).toBe(0);
  });

  it("combines region and channel filters (no match returns zero)", () => {
    const k = computeKpis(model, filters({ regions: ["South"], channels: ["Retail"] }));
    expect(k.netSales).toBe(0);
    expect(k.outstanding).toBe(0);
  });

  it("applies the product category filter through the order", () => {
    const k = computeKpis(model, filters({ categories: ["Cat B"] }));
    expect(k.netSales).toBe(138_000); // O2 + O4
    expect(k.outstanding).toBe(98_000); // I2 + I4 are both Cat B orders
  });

  it("chooses the last three complete months as the default period", () => {
    const f = defaultFilters(model);
    expect(f.start).toBe("2026-01-01");
    expect(f.end).toBe("2026-03-31");
  });

  it("drops an incomplete final month from the default period", () => {
    const b = tinyBundle();
    b.orders.push({ ...b.orders[0], order_id: "O9", order_date: "2026-04-03" });
    const f = defaultFilters(buildModel(b));
    expect(f.end).toBe("2026-03-31");
  });
});

describe("receivables aging", () => {
  const model = buildModel(tinyBundle());

  it("assigns aging buckets by days past due", () => {
    expect(agingBucket(-5)).toBe("Not yet due");
    expect(agingBucket(0)).toBe("Not yet due");
    expect(agingBucket(1)).toBe("1–30 days");
    expect(agingBucket(30)).toBe("1–30 days");
    expect(agingBucket(31)).toBe("31–60 days");
    expect(agingBucket(90)).toBe("61–90 days");
    expect(agingBucket(91)).toBe("90+ days");
  });

  it("distributes the outstanding balance into buckets that sum to the total", () => {
    const snap = receivablesSnapshot(model, Q1_2026);
    const byBucket = Object.fromEntries(snap.aging.map((a) => [a.bucket, a.amount]));
    expect(byBucket["Not yet due"]).toBe(38_000);
    expect(byBucket["1–30 days"]).toBe(60_000);
    expect(snap.aging.reduce((s, a) => s + a.amount, 0)).toBe(snap.outstanding);
  });

  it("ages the same balance further at a later snapshot date", () => {
    const snap = receivablesSnapshot(model, Q1_2026, "2026-06-30");
    const byBucket = Object.fromEntries(snap.aging.map((a) => [a.bucket, a.amount]));
    expect(byBucket["90+ days"]).toBe(60_000); // I2: 105 days past due
    expect(byBucket["31–60 days"]).toBe(38_000); // I4: 57 days past due
  });

  it("summarises balances by customer with credit utilisation", () => {
    const rows = receivablesByCustomer(model, Q1_2026);
    const c2 = rows.find((r) => r.customer_id === "C2")!;
    expect(c2.outstanding).toBe(60_000);
    expect(c2.overdue).toBe(60_000);
    expect(c2.oldestDaysPastDue).toBe(14);
    expect(c2.creditUtilizationPct).toBeCloseTo(6, 6);
    expect(rows[0].customer_id).toBe("C2"); // sorted by overdue
  });

  it("summarises overdue by region", () => {
    const rows = overdueByRegion(model, Q1_2026);
    expect(rows.find((r) => r.region === "North")!.overdue).toBe(60_000);
    expect(rows.find((r) => r.region === "South")!.overdue).toBe(0);
  });

  it("never reports negative outstanding for overpaid invoices", () => {
    const b = tinyBundle();
    b.invoices[2] = { ...b.invoices[2], amount_paid_pkr: 50_000, payment_date: "2026-03-10", status: "Paid" };
    const snap = receivablesSnapshot(buildModel(b), Q1_2026);
    expect(snap.outstanding).toBe(60_000);
  });
});
