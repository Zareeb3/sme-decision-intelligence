/**
 * Cross-check: the TypeScript engine must agree with the independent pandas
 * implementation in scripts/reference_kpis.py (output: evals/reference_kpis.json).
 * Regenerate the reference after changing the sample data:
 *   python scripts/reference_kpis.py
 */
import { describe, expect, it } from "vitest";
import { buildModel } from "../src/lib/analytics/model";
import { computeKpis } from "../src/lib/analytics/kpis";
import { receivablesSnapshot } from "../src/lib/analytics/receivables";
import { customerConcentration } from "../src/lib/analytics/concentration";
import type { Filters } from "../src/lib/analytics/filters";
import { readJson, sampleBundle } from "./fixtures";

interface Ref {
  filters: { start: string; end: string; regions: string[]; channels: string[] };
  netSales: number;
  estCogs: number;
  orderCount: number;
  collections: number;
  outstanding: number;
  overdue: number;
  aging: Record<string, number>;
  invoicesRaised: number;
  invoicesFullyPaid: number;
  top5SharePct: number;
  hhi: number;
  salesTarget: number | null;
  collectionTarget: number | null;
  openComplaints: number;
}

const refs = readJson<Record<string, Ref>>("evals/reference_kpis.json");
const model = buildModel(sampleBundle());

for (const [id, ref] of Object.entries(refs)) {
  describe(`engine matches pandas reference: ${id}`, () => {
    const f: Filters = { ...ref.filters, categories: [], productIds: [] };
    const k = computeKpis(model, f);

    it("net sales, COGS and order count", () => {
      expect(k.netSales).toBeCloseTo(ref.netSales, 2);
      expect(k.estCogs).toBeCloseTo(ref.estCogs, 2);
      expect(k.orderCount).toBe(ref.orderCount);
    });
    it("collections", () => expect(k.collections).toBeCloseTo(ref.collections, 2));
    it("outstanding and overdue", () => {
      expect(k.outstanding).toBeCloseTo(ref.outstanding, 2);
      expect(k.overdue).toBeCloseTo(ref.overdue, 2);
    });
    it("aging buckets", () => {
      const snap = receivablesSnapshot(model, f);
      for (const a of snap.aging) expect(a.amount).toBeCloseTo(ref.aging[a.bucket], 2);
    });
    it("invoice paid ratio", () => {
      expect(k.invoicesRaised).toBe(ref.invoicesRaised);
      expect(k.invoicePaidRatioPct ?? 0).toBeCloseTo(ref.invoicesRaised ? (ref.invoicesFullyPaid / ref.invoicesRaised) * 100 : 0, 6);
    });
    it("customer concentration", () => {
      const c = customerConcentration(model, f);
      expect(c.top5SharePct).toBeCloseTo(ref.top5SharePct, 6);
      expect(c.hhi).toBeCloseTo(ref.hhi, 4);
    });
    it("targets", () => {
      if (ref.salesTarget === null) expect(k.salesTarget).toBeNull();
      else {
        expect(k.salesTarget).toBeCloseTo(ref.salesTarget, 2);
        expect(k.collectionTarget).toBeCloseTo(ref.collectionTarget!, 2);
      }
    });
    it("open complaints", () => expect(k.openComplaints).toBe(ref.openComplaints));
  });
}
