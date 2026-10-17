import { describe, expect, it } from "vitest";
import { mkdtempSync, existsSync, readdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { Storage, sampleDataEnabled, storageStatus } from "../src/lib/server/storage";
import { importDropFolder, ingest, jsonToCsv, tokenMatches } from "../src/lib/server/ingest";
import { buildBundle } from "../src/lib/data/load";
import type { DatasetKind } from "../src/lib/data/types";
import { readSample } from "./fixtures";

const tmp = () => new Storage(mkdtempSync(path.join(tmpdir(), "sdi-")));

describe("storage configuration", () => {
  it("is off on Vercel unless DATA_DIR is set, and on by default elsewhere", () => {
    expect(storageStatus({ VERCEL: "1" }).enabled).toBe(false);
    expect(storageStatus({ VERCEL: "1", DATA_DIR: "/srv/data" }).enabled).toBe(true);
    expect(storageStatus({}).enabled).toBe(true);
  });
  it("lets company deployments hide the sample data", () => {
    expect(sampleDataEnabled({})).toBe(true);
    expect(sampleDataEnabled({ ENABLE_SAMPLE_DATA: "false" })).toBe(false);
  });
});

describe("ingest", () => {
  it("stores a validated canonical copy and records it in the manifest", async () => {
    const s = tmp();
    const r = await ingest(s, "customers", "Customer Code;Name;Zone\nC1;Shah Traders;North\nC2;Noor Tiles;South\n", { source: "pipeline", by: "test" });
    expect(r.ok).toBe(true);
    expect(r.rowsStored).toBe(2);
    const stored = await s.readDataset("customers");
    expect(stored!.split("\n")[0]).toContain("customer_id,customer_name");
    const m = await s.readManifest();
    expect(m.customers!.rows).toBe(2);
    expect(m.customers!.source).toBe("pipeline");
  });

  it("rejects a broken file and keeps the previous data", async () => {
    const s = tmp();
    await ingest(s, "customers", "customer_id,customer_name,region\nC1,A,North\n", { source: "upload", by: "t" });
    const bad = await ingest(s, "customers", "customer_id,customer_name\nC9,Z\n", { source: "upload", by: "t" });
    expect(bad.ok).toBe(false);
    expect(bad.fileErrors[0]).toContain("region");
    expect((await s.readDataset("customers"))!).toContain("C1");
  });

  it("appends incremental loads by key, newer rows winning", async () => {
    const s = tmp();
    await ingest(s, "customers", "customer_id,customer_name,region\nC1,Old name,North\nC2,B,South\n", { source: "pipeline", by: "t" });
    const r = await ingest(s, "customers", "customer_id,customer_name,region\nC1,New name,North\nC3,C,West\n", { source: "pipeline", by: "t", mode: "append" });
    expect(r.rowsStored).toBe(3);
    const text = (await s.readDataset("customers"))!;
    expect(text).toContain("New name");
    expect(text).not.toContain("Old name");
  });

  it("rolls back to the previous version", async () => {
    const s = tmp();
    await ingest(s, "customers", "customer_id,customer_name,region\nC1,First,North\n", { source: "upload", by: "t" });
    await ingest(s, "customers", "customer_id,customer_name,region\nC1,Second,North\n", { source: "upload", by: "t" });
    expect(await s.rollback("customers")).toBe(true);
    expect((await s.readDataset("customers"))!).toContain("First");
    expect(await s.rollback("customers")).toBe(false);
  });

  it("round-trips the full sample through storage without losing a row or a rupee", async () => {
    const s = tmp();
    const kinds: DatasetKind[] = ["orders", "customers", "invoices", "targets", "complaints"];
    for (const k of kinds) expect((await ingest(s, k, readSample(k), { source: "pipeline", by: "t" })).ok).toBe(true);
    const original = buildBundle(Object.fromEntries(kinds.map((k) => [k, readSample(k)])), "sample").bundle!;
    const texts = Object.fromEntries(await Promise.all(kinds.map(async (k) => [k, (await s.readDataset(k))!] as const)));
    const roundTrip = buildBundle(texts, "pipeline").bundle!;
    const sum = (b: typeof original) => b.orders.reduce((a, o) => a + o.net_sales_pkr, 0);
    expect(roundTrip.orders.length).toBe(original.orders.length);
    expect(sum(roundTrip)).toBeCloseTo(sum(original), 2);
    expect(roundTrip.invoices.length).toBe(original.invoices.length);
  });

  it("accepts JSON rows from pipelines", () => {
    const csv = jsonToCsv([{ customer_id: "C1", customer_name: "A, B & Co", region: "North" }]);
    expect(csv.split("\n")[1]).toBe('C1,"A, B & Co",North');
    expect(() => jsonToCsv({ nope: 1 })).toThrow();
  });
});

describe("drop folder", () => {
  it("imports files by name, archives them and reports failures", async () => {
    const s = tmp();
    await s.ensure();
    writeFileSync(path.join(s.incomingDir, "customers_2026-10-17.csv"), "customer_id,customer_name,region\nC1,A,North\n");
    writeFileSync(path.join(s.incomingDir, "mystery.csv"), "foo,bar\n1,2\n");
    const results = await importDropFolder(s);
    expect(results.map((r) => [r.kind, r.ok])).toEqual([["customers", true]]);
    expect(readdirSync(s.incomingDir)).toEqual([]);
    expect(readdirSync(path.join(s.dir, "processed")).some((f) => f.endsWith("customers_2026-10-17.csv"))).toBe(true);
    expect(readdirSync(path.join(s.dir, "failed")).some((f) => f.endsWith("mystery.csv.log"))).toBe(true);
    expect(existsSync(path.join(s.dir, "datasets", "customers.csv"))).toBe(true);
  });
});

describe("tokens", () => {
  it("compares tokens safely", () => {
    expect(tokenMatches("abc", "abc")).toBe(true);
    expect(tokenMatches("abd", "abc")).toBe(false);
    expect(tokenMatches(null, "abc")).toBe(false);
    expect(tokenMatches("abc", undefined)).toBe(false);
  });
});
