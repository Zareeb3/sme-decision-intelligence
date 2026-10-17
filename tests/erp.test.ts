/**
 * Real-company data: ERP export formats, column mapping, several payments per
 * invoice, credit notes, company settings, fiscal years and anonymisation.
 */
import { describe, expect, it } from "vitest";
import { parseCsv, detectDelimiter } from "../src/lib/data/csv";
import { detectDateFormat, normaliseDate, normaliseEnum, normaliseMonth, normaliseNumber } from "../src/lib/data/normalise";
import { autoMap, detectKind, missingRequired } from "../src/lib/data/mapping";
import { validateCsv } from "../src/lib/data/validate";
import { buildBundle } from "../src/lib/data/load";
import { buildModel } from "../src/lib/analytics/model";
import { computeKpis } from "../src/lib/analytics/kpis";
import { receivablesSnapshot } from "../src/lib/analytics/receivables";
import { customerProfiles } from "../src/lib/analytics/customers";
import { fiscalQuarterKey, fiscalYearOf, fiscalYearRange } from "../src/lib/analytics/dates";
import { formatMoney } from "../src/lib/analytics/format";
import { DEFAULT_RULES, getSettings, parseSettings, SAMPLE_SETTINGS, setSettings } from "../src/lib/settings";
import { anonymisePacket, deanonymiseResponse } from "../src/lib/ai/anonymise";
import { buildEvidence } from "../src/lib/ai/evidence";
import { checkGrounding } from "../src/lib/ai/grounding";
import { Q1_2026, filters, tinyBundle } from "./fixtures";

describe("export formats", () => {
  it("detects comma, semicolon, tab and SAP pipe delimiters", () => {
    expect(detectDelimiter("a,b,c\n1,2,3")).toBe(",");
    expect(detectDelimiter("a;b;c\n1;2;3")).toBe(";");
    expect(detectDelimiter("a\tb\tc\n1\t2\t3")).toBe("\t");
    expect(detectDelimiter("|a|b|c|\n|1|2|3|")).toBe("|");
  });

  it("parses SAP list output with ruler lines and wrapping pipes", () => {
    const text = "-----------------\n| KUNNR | NAME1 |\n-----------------\n| C1 | Shah Traders |\n| C2 | Noor Tiles |\n-----------------\n";
    const p = parseCsv(text);
    expect(p.headers).toEqual(["kunnr", "name1"]);
    expect(p.rows).toEqual([
      { kunnr: "C1", name1: "Shah Traders" },
      { kunnr: "C2", name1: "Noor Tiles" },
    ]);
  });

  it("normalises numbers written in SAP, Excel and European styles", () => {
    expect(normaliseNumber("1,234,567.50")).toBe("1234567.50");
    expect(normaliseNumber("1.234.567,50")).toBe("1234567.50");
    expect(normaliseNumber("1,250.00-")).toBe("-1250.00");
    expect(normaliseNumber("(500)")).toBe("-500");
    expect(normaliseNumber("PKR 2,000")).toBe("2000");
    expect(normaliseNumber("12,5")).toBe("12.5");
    expect(normaliseNumber("")).toBe("");
    expect(normaliseNumber("n/a")).toBe("n/a");
  });

  it("detects and converts date formats", () => {
    expect(detectDateFormat(["30.09.2026", "01.10.2026"])).toBe("DMY");
    expect(detectDateFormat(["09/30/2026"])).toBe("MDY");
    expect(detectDateFormat(["20260930"])).toBe("YYYYMMDD");
    expect(normaliseDate("30.09.2026", "DMY")).toBe("2026-09-30");
    expect(normaliseDate("9/30/2026", "MDY")).toBe("2026-09-30");
    expect(normaliseDate("20260930", "ISO")).toBe("2026-09-30");
    expect(normaliseDate("2026-09-30 00:00:00", "ISO")).toBe("2026-09-30");
    expect(normaliseDate("00000000", "YYYYMMDD")).toBe("");
  });

  it("normalises months and coded values", () => {
    expect(normaliseMonth("09.2026")).toBe("2026-09");
    expect(normaliseMonth("Sep 2026")).toBe("2026-09");
    expect(normaliseMonth("202609")).toBe("2026-09");
    expect(normaliseEnum("order_status", "F2")).toBe("Delivered");
    expect(normaliseEnum("order_status", "G2")).toBe("Credit Note");
    expect(normaliseEnum("order_status", "S1")).toBe("Cancelled");
    expect(normaliseEnum("severity", "1")).toBe("High");
    expect(normaliseEnum("account_status", "Blocked")).toBe("On Hold");
  });
});

describe("column mapping", () => {
  it("maps SAP technical field names automatically", () => {
    const m = autoMap("orders", ["vbeln", "fkdat", "kunag", "matnr", "arktx", "matkl", "fkimg", "netwr", "wavwr", "fkart"]);
    expect(m).toMatchObject({
      order_id: "vbeln",
      order_date: "fkdat",
      customer_id: "kunag",
      product_id: "matnr",
      product_name: "arktx",
      product_category: "matkl",
      quantity_sqm: "fkimg",
      net_sales_pkr: "netwr",
      est_cogs_pkr: "wavwr",
      order_status: "fkart",
    });
    expect(missingRequired("orders", m)).toEqual([]);
  });

  it("maps everyday English headers and reports what is missing", () => {
    const m = autoMap("customers", ["customer_code", "customer_name", "zone", "credit_limit"]);
    expect(m.customer_id).toBe("customer_code");
    expect(m.region).toBe("zone");
    expect(m.credit_limit_pkr).toBe("credit_limit");
    expect(missingRequired("customers", autoMap("customers", ["customer_code"]))).toEqual(["customer_name", "region"]);
  });

  it("recognises which dataset a file is", () => {
    expect(detectKind("Customer master export.csv", [])).toBe("customers");
    expect(detectKind("export1.csv", ["invoice_id", "payment_date", "amount"])).toBe("payments");
  });

  it("validates an SAP-style sales export end to end with defaults filled", () => {
    const text = [
      "VBELN\tFKDAT\tKUNAG\tMATNR\tFKIMG\tNETWR\tWAVWR\tFKART",
      "90000001\t30.09.2026\tC1\tM-100\t1,000\t2,500,000.00\t1,800,000.00\tF2",
      "90000002\t30.09.2026\tC1\tM-100\t100-\t250,000.00-\t180,000.00-\tG2",
      "90000003\t30.09.2026\tC1\tM-100\t10\t25,000.00\t18,000.00\tS1",
    ].join("\n");
    const r = validateCsv<{ order_status: string; net_sales_pkr: number; product_category: string; order_date: string; quantity_sqm: number }>("orders", text);
    expect(r.ok).toBe(true);
    expect(r.rowIssues).toEqual([]);
    expect(r.rows.map((x) => x.order_status)).toEqual(["Delivered", "Credit Note", "Cancelled"]);
    expect(r.rows[1].net_sales_pkr).toBe(250_000);
    expect(r.rows[1].quantity_sqm).toBe(100);
    expect(r.rows[0].order_date).toBe("2026-09-30");
    expect(r.rows[0].product_category).toBe("Uncategorised");
    expect(r.notes.some((n) => n.includes("day/month/year"))).toBe(true);
  });

  it("uses an explicit mapping chosen by the user", () => {
    const text = "Doc,When,Who,What,Qty,Value,Cost\nD1,2026-01-05,C1,P1,10,1000,600\n";
    const r = validateCsv("orders", text, {
      mapping: { order_id: "doc", order_date: "when", customer_id: "who", product_id: "what", quantity_sqm: "qty", net_sales_pkr: "value", est_cogs_pkr: "cost" },
    });
    expect(r.ok).toBe(true);
    expect(r.validRows).toBe(1);
  });
});

describe("ERP accounting realities", () => {
  it("treats credit notes as negative sales and excludes them from order counts", () => {
    const b = tinyBundle();
    b.orders.push({ ...b.orders[0], order_id: "CN1", order_date: "2026-03-20", net_sales_pkr: 9_000, est_cogs_pkr: 6_000, quantity_sqm: 10, order_status: "Credit Note" });
    const k = computeKpis(buildModel(b), Q1_2026);
    expect(k.netSales).toBe(228_000 - 9_000);
    expect(k.estCogs).toBe(130_000 - 6_000);
    expect(k.orderCount).toBe(3);
  });

  it("supports several partial payments per invoice, and credit notes that are not cash", () => {
    const b = tinyBundle();
    b.payments = [
      { payment_id: "P1", invoice_id: "I2", payment_date: "2026-03-01", amount_pkr: 30_000, payment_type: "Payment" },
      { payment_id: "P2", invoice_id: "I2", payment_date: "2026-03-25", amount_pkr: 20_000, payment_type: "Payment" },
      { payment_id: "P3", invoice_id: "I2", payment_date: "2026-03-28", amount_pkr: 5_000, payment_type: "Credit Note" },
      { payment_id: "P4", invoice_id: "I1", payment_date: "2026-03-20", amount_pkr: 90_000, payment_type: "Payment" },
    ];
    const m = buildModel(b);
    expect(m.hasPaymentsFile).toBe(true);
    const k = computeKpis(m, Q1_2026);
    expect(k.collections).toBe(140_000); // 30k + 20k + 90k; the credit note is not cash
    expect(k.outstanding).toBe(100_000 - 55_000 + 38_000); // I2 has 45k left, I4 38k
    // part-way through March only the first payment counts
    const mid = receivablesSnapshot(m, Q1_2026, "2026-03-10");
    expect(mid.outstanding).toBe(90_000 + 70_000 + 38_000);
  });

  it("fills due dates from customer payment terms and region from the customer", () => {
    const customers = "customer_id,customer_name,region,payment_terms_days\nC1,Shah Traders,North,45\n";
    const orders = "order_id,order_date,customer_id,product_id,quantity,net_sales,cost\nO1,2026-01-10,C1,P1,10,1000,700\n";
    const invoices = "invoice_id,customer_id,invoice_date,invoice_amount\nI1,C1,2026-01-10,1000\n";
    const res = buildBundle({ customers, orders, invoices }, "upload");
    expect(res.blockingErrors).toEqual([]);
    expect(res.bundle!.invoices[0].due_date).toBe("2026-02-24");
    expect(res.bundle!.orders[0].region).toBe("North");
    expect(res.bundle!.customers[0].account_status).toBe("Active");
  });
});

describe("company settings", () => {
  it("formats money in the configured currency", () => {
    const before = getSettings();
    setSettings({ ...before, currency: "USD" });
    expect(formatMoney(2_500_000)).toBe("USD 2.5M");
    setSettings(before);
    expect(formatMoney(2_500_000)).toBe("PKR 2.5M");
  });

  it("labels fiscal quarters and years", () => {
    expect(fiscalQuarterKey("2026-09-15", 1)).toBe("2026-Q3");
    expect(fiscalQuarterKey("2026-09-15", 7)).toBe("FY2027-Q1");
    expect(fiscalQuarterKey("2027-06-30", 7)).toBe("FY2027-Q4");
    expect(fiscalYearOf("2026-07-01", 7)).toBe(2027);
    expect(fiscalYearRange(2027, 7)).toEqual({ start: "2026-07-01", end: "2027-06-30" });
  });

  it("applies business-rule thresholds from settings", () => {
    const b = tinyBundle();
    b.orders.push({ ...b.orders[0], order_id: "O5", order_date: "2026-06-30" });
    const m = buildModel(b);
    const f = filters({ end: "2026-06-30" });
    const strict = customerProfiles(m, f).find((p) => p.customer_id === "C2")!;
    const lenient = customerProfiles(m, f, { ...DEFAULT_RULES.health, overdueShareHighPct: 100, overdueShareWatchPct: 100, oldestOverdueHighDays: 400, oldestOverdueWatchDays: 400 }).find((p) => p.customer_id === "C2")!;
    expect(lenient.healthScore!).toBeGreaterThan(strict.healthScore!);
  });

  it("merges partial saved settings onto defaults and rejects invalid ones", () => {
    const s = parseSettings({ companyName: "Acme", rules: { health: { healthyFrom: 85 } } }, SAMPLE_SETTINGS);
    expect(s.companyName).toBe("Acme");
    expect(s.rules.health.healthyFrom).toBe(85);
    expect(s.rules.health.watchFrom).toBe(60);
    expect(parseSettings({ currency: "X" }, SAMPLE_SETTINGS)).toEqual(SAMPLE_SETTINGS);
  });
});

describe("AI privacy", () => {
  it("replaces customer names before sending and restores them in the answer", () => {
    const m = buildModel(tinyBundle());
    const packet = buildEvidence(m, Q1_2026, "Who is overdue?", ["receivables_risk"]);
    expect(JSON.stringify(packet)).toContain("North Dealer");
    const { packet: anon, aliases } = anonymisePacket(packet, m.bundle.customers.map((c) => c.customer_name));
    expect(JSON.stringify(anon)).not.toContain("North Dealer");
    expect(JSON.stringify(anon)).toContain("Account A");
    const id = anon.items.find((i) => i.label.includes("Account"))!.id;
    const answer = { summary: "Account A is overdue.", facts: [{ statement: "Account A owes money.", evidence_ids: [id] }], hypotheses: [], recommendations: [], uncertainties: [], follow_up_questions: [] };
    expect(checkGrounding(answer, anon).grounded).toBe(true);
    expect(deanonymiseResponse(answer, aliases).summary).toMatch(/North Dealer|South Distributor/);
  });

  it("omits the synthetic-data caveat for company data and states the currency", () => {
    const b = { ...tinyBundle(), source: "upload" as const };
    const p = buildEvidence(buildModel(b), Q1_2026, "q", ["next_steps"]);
    expect(p.limitations.some((l) => l.includes("synthetic"))).toBe(false);
    expect(p.currency).toBe("PKR");
  });
});

describe("example ERP exports (data/example_exports)", () => {
  it("load through automatic matching with no row issues and the same KPIs as the original data", async () => {
    const { readFileSync } = await import("node:fs");
    const path = await import("node:path");
    const dir = path.resolve(__dirname, "../data/example_exports");
    const files = ["sales_register_export.csv", "customer_master_export.csv", "invoices_ar_export.csv", "targets_plan.csv", "complaints_qm_export.csv"];
    const texts: Record<string, string> = {};
    for (const f of files) {
      const t = readFileSync(path.join(dir, f), "utf8");
      const kind = detectKind(f, parseCsv(t.slice(0, 5000)).headers);
      expect(kind).not.toBeNull();
      texts[kind!] = t;
    }
    const res = buildBundle(texts, "upload");
    expect(res.blockingErrors).toEqual([]);
    for (const r of Object.values(res.results)) expect(r!.rowIssues).toEqual([]);
    const k = computeKpis(buildModel(res.bundle!), { start: "2026-07-01", end: "2026-09-30", regions: [], channels: [], categories: [], productIds: [] });
    expect(Math.round(k.netSales)).toBe(928_567_583);
    expect(Math.round(k.collections)).toBe(793_970_933);
    expect(Math.round(k.overdue)).toBe(213_185_246);
  });
});
