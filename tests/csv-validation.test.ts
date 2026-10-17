import { describe, expect, it } from "vitest";
import { parseCsv, toCsv } from "../src/lib/data/csv";
import { checkBundleConsistency, validateCsv } from "../src/lib/data/validate";
import { buildBundle } from "../src/lib/data/load";
import { readMessy, readSample, tinyBundle } from "./fixtures";

describe("CSV parser", () => {
  it("parses quoted fields, escaped quotes, embedded commas and newlines", () => {
    const text = 'id,name,note\r\n1,"Shah, Sons","He said ""ok"""\r\n2,"Multi\nline",x\r\n';
    const p = parseCsv(text);
    expect(p.headers).toEqual(["id", "name", "note"]);
    expect(p.rows).toEqual([
      { id: "1", name: "Shah, Sons", note: 'He said "ok"' },
      { id: "2", name: "Multi\nline", note: "x" },
    ]);
  });

  it("strips a UTF-8 BOM and normalises header names", () => {
    const p = parseCsv("﻿Order ID,Net Sales\nA,1\n");
    expect(p.headers).toEqual(["order_id", "net_sales"]);
  });

  it("reports rows with the wrong number of fields", () => {
    const p = parseCsv("a,b\n1,2\n3\n4,5\n");
    expect(p.rows).toHaveLength(2);
    expect(p.malformedLines).toEqual([3]);
  });

  it("round-trips through toCsv", () => {
    const rows = [{ a: "x,y", b: 'q"t' }];
    expect(parseCsv(toCsv(rows)).rows).toEqual(rows);
  });
});

describe("dataset validation", () => {
  it("accepts every supplied sample file without issues", () => {
    for (const kind of ["orders", "customers", "invoices", "targets", "complaints"] as const) {
      const r = validateCsv(kind, readSample(kind));
      expect(r.ok).toBe(true);
      expect(r.rowIssues).toHaveLength(0);
      expect(r.validRows).toBeGreaterThan(0);
    }
  });

  it("flags invalid dates, negative values, missing values and duplicates in the messy file", () => {
    const r = validateCsv("orders", readMessy("orders_with_errors.csv"));
    expect(r.ok).toBe(true); // valid rows remain usable
    const messages = r.rowIssues.map((i) => `${i.column}: ${i.message}`);
    expect(messages.some((m) => m.startsWith("order_date") && m.includes("real date"))).toBe(true);
    expect(messages.some((m) => m.startsWith("quantity_sqm") && m.includes("cannot be negative"))).toBe(true);
    expect(messages.some((m) => m.startsWith("net_sales_pkr") && m.includes("required"))).toBe(true);
    expect(messages.some((m) => m.includes("Duplicate"))).toBe(true);
    expect(r.validRows).toBe(37); // 41 rows - 3 invalid - 1 duplicate
    expect(r.warnings.some((w) => w.includes("excluded"))).toBe(true);
  });

  it("rejects a file with a missing required column and names the column", () => {
    const r = validateCsv("customers", readMessy("customers_missing_region.csv"));
    expect(r.ok).toBe(false);
    expect(r.fileErrors[0]).toContain("region");
  });

  it("rejects an empty file and a header-only file", () => {
    expect(validateCsv("invoices", "").fileErrors[0]).toContain("empty");
    const r = validateCsv("invoices", readMessy("invoices_empty.csv"));
    expect(r.ok).toBe(false);
    expect(r.fileErrors[0]).toContain("no data rows");
  });

  it("rejects invoices whose due date precedes the invoice date", () => {
    const text =
      "invoice_id,order_id,customer_id,invoice_date,due_date,invoice_amount_pkr,amount_paid_pkr,payment_date,status\n" +
      "I1,O1,C1,2026-03-10,2026-03-01,100,0,,Open\n";
    const r = validateCsv("invoices", text);
    expect(r.rowIssues[0].message).toContain("due_date cannot be before invoice_date");
  });

  it("rejects a payment amount without a payment date", () => {
    const text =
      "invoice_id,order_id,customer_id,invoice_date,due_date,invoice_amount_pkr,amount_paid_pkr,payment_date,status\n" +
      "I1,O1,C1,2026-03-10,2026-04-01,100,50,,Partially Paid\n";
    expect(validateCsv("invoices", text).rowIssues[0].column).toBe("payment_date");
  });

  it("detects duplicate composite keys in targets", () => {
    const text = "month,region,sales_target_pkr,collection_target_pkr\n2026-01,South,1,1\n2026-01,South,2,2\n";
    const r = validateCsv("targets", text);
    expect(r.validRows).toBe(1);
    expect(r.rowIssues[0].message).toContain("Duplicate");
  });

  it("accepts thousands separators in numbers", () => {
    const text = 'month,region,sales_target_pkr,collection_target_pkr\n2026-01,South,"1,200,000",900000\n';
    const r = validateCsv("targets", text);
    expect((r.rows[0] as { sales_target_pkr: number }).sales_target_pkr).toBe(1_200_000);
  });
});

describe("bundle loading and cross-file checks", () => {
  it("blocks loading when a required file is missing", () => {
    const res = buildBundle({ orders: readSample("orders") }, "upload");
    expect(res.bundle).toBeNull();
    expect(res.blockingErrors.join(" ")).toContain("invoices.csv");
  });

  it("warns about orders referencing unknown customers", () => {
    const b = tinyBundle();
    b.orders.push({ ...b.orders[0], order_id: "O99", customer_id: "C404" });
    const warnings = checkBundleConsistency(b);
    expect(warnings.some((w) => w.includes("C404"))).toBe(true);
  });

  it("produces no consistency warnings for the sample data", () => {
    const kinds = ["orders", "customers", "invoices", "targets", "complaints"] as const;
    const res = buildBundle(Object.fromEntries(kinds.map((k) => [k, readSample(k)])), "sample");
    expect(res.consistencyWarnings).toEqual([]);
  });
});
