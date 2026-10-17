/**
 * End-to-end check of the SAP pipeline:
 *   SAP-style extracts (data/sap_sample) -> pipeline/sap_pipeline.py -> canonical CSVs
 *   -> the app's loader -> KPIs that must equal the KPIs of the original sample data.
 * Needs Python 3 with pandas; the test is skipped (with a message) when unavailable.
 */
import { describe, expect, it } from "vitest";
import { spawnSync } from "node:child_process";
import { mkdtempSync, readFileSync, existsSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { buildBundle } from "../src/lib/data/load";
import { buildModel } from "../src/lib/analytics/model";
import { computeKpis } from "../src/lib/analytics/kpis";
import { receivablesSnapshot } from "../src/lib/analytics/receivables";
import type { Filters } from "../src/lib/analytics/filters";
import type { DatasetKind } from "../src/lib/data/types";
import { sampleBundle } from "./fixtures";

const ROOT = path.resolve(__dirname, "..");
const python = ["python3", "python"].find((p) => spawnSync(p, ["-c", "import pandas"], { encoding: "utf8" }).status === 0);

describe("SAP pipeline end to end", () => {
  if (!python) {
    it("is skipped because Python with pandas is not installed", () => {
      expect(true).toBe(true);
    });
    return;
  }

  const out = mkdtempSync(path.join(tmpdir(), "sap-"));
  const run = spawnSync(python, ["pipeline/sap_pipeline.py", "--input", "data/sap_sample", "--config", "pipeline/config.sample.json", "--out", out], { cwd: ROOT, encoding: "utf8" });

  it("runs without integrity problems", () => {
    expect(run.status).toBe(0);
    const report = JSON.parse(readFileSync(path.join(out, "pipeline_report.json"), "utf8"));
    expect(report.ok).toBe(true);
    expect(report.warnings).toEqual([]);
  });

  it("produces data the app accepts without row errors", () => {
    const kinds: DatasetKind[] = ["orders", "customers", "invoices", "payments", "targets", "complaints"];
    const texts = Object.fromEntries(kinds.filter((k) => existsSync(path.join(out, `${k}.csv`))).map((k) => [k, readFileSync(path.join(out, `${k}.csv`), "utf8")]));
    const res = buildBundle(texts, "pipeline");
    expect(res.blockingErrors).toEqual([]);
    for (const r of Object.values(res.results)) expect(r!.rowIssues).toEqual([]);
    expect(res.bundle!.payments.length).toBeGreaterThan(0);

    const a = buildModel(sampleBundle());
    const b = buildModel(res.bundle!);
    const periods: Filters[] = [
      { start: "2026-07-01", end: "2026-09-30", regions: [], channels: [], categories: [], productIds: [] },
      { start: "2025-01-01", end: "2025-12-31", regions: ["South"], channels: [], categories: [], productIds: [] },
    ];
    for (const f of periods) {
      const ka = computeKpis(a, f);
      const kb = computeKpis(b, f);
      for (const k of ["netSales", "estCogs", "collections", "outstanding", "overdue", "over90", "salesTarget", "openComplaints", "invoicesRaised"] as const) {
        expect({ k, v: Math.round((kb[k] as number) ?? 0) }).toEqual({ k, v: Math.round((ka[k] as number) ?? 0) });
      }
      expect(receivablesSnapshot(b, f).aging.map((x) => Math.round(x.amount))).toEqual(receivablesSnapshot(a, f).aging.map((x) => Math.round(x.amount)));
    }
  });
});
