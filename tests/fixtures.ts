/**
 * Test fixtures.
 *
 * `tinyBundle()` is a hand-built dataset small enough that every expected
 * number in the tests can be checked with a calculator. The comments next to
 * each record give the values the tests rely on.
 */
import { readFileSync } from "node:fs";
import path from "node:path";
import { buildBundle } from "../src/lib/data/load";
import type { DataBundle, DatasetKind } from "../src/lib/data/types";
import type { Filters } from "../src/lib/analytics/filters";

export function tinyBundle(): DataBundle {
  return {
    source: "sample",
    customers: [
      { customer_id: "C1", customer_name: "South Distributor", customer_type: "Distributor", channel: "Distribution", region: "South", city: "Karachi", payment_terms_days: 60, credit_limit_pkr: 10_000_000, onboarding_date: "2020-01-01", account_status: "Active" },
      { customer_id: "C2", customer_name: "North Dealer", customer_type: "Dealer", channel: "Retail", region: "North", city: "Islamabad", payment_terms_days: 30, credit_limit_pkr: 1_000_000, onboarding_date: "2020-01-01", account_status: "Active" },
    ],
    orders: [
      // net 90,000; cogs 60,000; gross (list) 100,000
      { order_id: "O1", order_date: "2026-01-10", customer_id: "C1", region: "South", channel: "Distribution", product_id: "P1", product_name: "Tile A", product_category: "Cat A", quantity_sqm: 100, list_price_per_sqm: 1000, discount_pct: 10, net_sales_pkr: 90_000, est_unit_cost_per_sqm: 600, est_cogs_pkr: 60_000, order_status: "Delivered" },
      // net 100,000; cogs 50,000; gross 100,000
      { order_id: "O2", order_date: "2026-02-15", customer_id: "C2", region: "North", channel: "Retail", product_id: "P2", product_name: "Tile B", product_category: "Cat B", quantity_sqm: 50, list_price_per_sqm: 2000, discount_pct: 0, net_sales_pkr: 100_000, est_unit_cost_per_sqm: 1000, est_cogs_pkr: 50_000, order_status: "Delivered" },
      // cancelled: must be excluded everywhere
      { order_id: "O3", order_date: "2026-02-20", customer_id: "C1", region: "South", channel: "Distribution", product_id: "P1", product_name: "Tile A", product_category: "Cat A", quantity_sqm: 10, list_price_per_sqm: 1000, discount_pct: 0, net_sales_pkr: 10_000, est_unit_cost_per_sqm: 600, est_cogs_pkr: 6_000, order_status: "Cancelled" },
      // net 38,000; cogs 20,000; gross 40,000
      { order_id: "O4", order_date: "2026-03-05", customer_id: "C1", region: "South", channel: "Distribution", product_id: "P2", product_name: "Tile B", product_category: "Cat B", quantity_sqm: 20, list_price_per_sqm: 2000, discount_pct: 5, net_sales_pkr: 38_000, est_unit_cost_per_sqm: 1000, est_cogs_pkr: 20_000, order_status: "Delivered" },
    ],
    invoices: [
      // paid in full on 20 Mar (after due date 11 Mar)
      { invoice_id: "I1", order_id: "O1", customer_id: "C1", invoice_date: "2026-01-10", due_date: "2026-03-11", invoice_amount_pkr: 90_000, amount_paid_pkr: 90_000, payment_date: "2026-03-20", status: "Paid" },
      // 40,000 paid on 31 Mar (the last date in the fixture); 60,000 still open; due 17 Mar
      { invoice_id: "I2", order_id: "O2", customer_id: "C2", invoice_date: "2026-02-15", due_date: "2026-03-17", invoice_amount_pkr: 100_000, amount_paid_pkr: 40_000, payment_date: "2026-03-31", status: "Partially Paid" },
      // unpaid, not yet due at 31 Mar
      { invoice_id: "I4", order_id: "O4", customer_id: "C1", invoice_date: "2026-03-05", due_date: "2026-05-04", invoice_amount_pkr: 38_000, amount_paid_pkr: 0, payment_date: "", status: "Open" },
    ],
    payments: [],
    targets: ["2026-01", "2026-02", "2026-03"].flatMap((month) => [
      { month, region: "South", sales_target_pkr: 50_000, collection_target_pkr: 40_000 },
      { month, region: "North", sales_target_pkr: 60_000, collection_target_pkr: 30_000 },
    ]),
    complaints: [
      { complaint_id: "K1", date_opened: "2026-02-20", customer_id: "C2", order_id: "O2", product_id: "P2", category: "Shade Variation", severity: "High", assigned_team: "Quality", status: "Open", date_resolved: "", claim_value_pkr: 5_000 },
      { complaint_id: "K2", date_opened: "2026-01-15", customer_id: "C1", order_id: "O1", product_id: "P1", category: "Delivery Delay", severity: "Low", assigned_team: "Logistics", status: "Resolved", date_resolved: "2026-01-20", claim_value_pkr: 0 },
    ],
  };
}

export const Q1_2026: Filters = { start: "2026-01-01", end: "2026-03-31", regions: [], channels: [], categories: [], productIds: [] };

export function filters(partial: Partial<Filters>): Filters {
  return { ...Q1_2026, ...partial };
}

const ROOT = path.resolve(__dirname, "..");

export function readSample(kind: DatasetKind): string {
  return readFileSync(path.join(ROOT, "public", "sample-data", `${kind}.csv`), "utf8");
}

export function readMessy(file: string): string {
  return readFileSync(path.join(ROOT, "data", "messy", file), "utf8");
}

let sampleCache: DataBundle | null = null;
export function sampleBundle(): DataBundle {
  if (sampleCache) return sampleCache;
  const kinds: DatasetKind[] = ["orders", "customers", "invoices", "targets", "complaints"];
  const res = buildBundle(Object.fromEntries(kinds.map((k) => [k, readSample(k)])), "sample");
  if (!res.bundle) throw new Error(res.blockingErrors.join("; "));
  sampleCache = res.bundle;
  return sampleCache;
}

export function readJson<T>(rel: string): T {
  return JSON.parse(readFileSync(path.join(ROOT, rel), "utf8")) as T;
}
