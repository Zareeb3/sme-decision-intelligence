import { describe, expect, it } from "vitest";
import { buildModel } from "../src/lib/analytics/model";
import { defaultFilters } from "../src/lib/analytics/filters";
import { routeQuestion } from "../src/lib/ai/router";
import { buildEvidence, byKey } from "../src/lib/ai/evidence";
import { checkGrounding, extractNumbers } from "../src/lib/ai/grounding";
import { demoExplain } from "../src/lib/ai/demo";
import { answerFromEvidence } from "../src/lib/ai/ask";
import { explainWithClaude } from "../src/lib/ai/anthropic";
import { evidencePacketSchema, type AnalystResponse } from "../src/lib/ai/types";
import { runEvalCase, type EvalCase } from "../src/lib/ai/evals";
import { readJson, sampleBundle } from "./fixtures";

const model = buildModel(sampleBundle());
const base = defaultFilters(model);

describe("question router", () => {
  it("routes the sales-vs-collections question", () => {
    expect(routeQuestion("Why did sales increase while collections fell behind?").analyses).toContain("sales_vs_collections");
  });
  it("extracts the scenario percentage", () => {
    expect(routeQuestion("What if collections improve by 15%?").scenarioPct).toBe(15);
    expect(routeQuestion("What could happen if collections improve?").scenarioPct).toBe(10);
  });
  it("narrows filters from region and quarter mentions", () => {
    const r = routeQuestion("Overdue balances in the North region for Q2 2026", model);
    expect(r.filterOverrides.regions).toEqual(["North"]);
    expect(r.filterOverrides.start).toBe("2026-04-01");
    expect(r.filterOverrides.end).toBe("2026-06-30");
  });
  it("falls back to an overview for vague questions and says so", () => {
    const r = routeQuestion("hello there");
    expect(r.fallback).toBe(true);
    expect(r.analyses).toEqual(["next_steps"]);
    expect(r.interpretation[0]).toContain("No specific analysis");
  });
});

describe("evidence packets", () => {
  const packet = buildEvidence(model, base, "Why did sales increase while collections fell behind?", ["sales_vs_collections"]);

  it("produce a schema-valid packet with unique sequential IDs", () => {
    expect(evidencePacketSchema.safeParse(packet).success).toBe(true);
    expect(packet.items.map((i) => i.id)).toEqual(packet.items.map((_, i) => `E${i + 1}`));
  });
  it("carry values computed by the analytics engine", () => {
    expect(byKey(packet, "kpi.netSales")!.value).toBeCloseTo(928_567_583, 0);
    expect(byKey(packet, "kpi.netSales")!.display).toBe("PKR 928.6M");
  });
  it("always include the standing limitations", () => {
    expect(packet.limitations.some((l) => l.includes("synthetic"))).toBe(true);
  });
});

describe("grounding check", () => {
  const packet = buildEvidence(model, base, "How are receivables?", ["receivables_risk"]);
  const od = byKey(packet, "kpi.overdue")!;
  const pct = byKey(packet, "kpi.overduePct")!;
  const ok: AnalystResponse = {
    summary: `Overdue receivables are ${od.display}.`,
    facts: [{ statement: `Overdue balance is ${od.display}, ${pct.display} of outstanding.`, evidence_ids: [od.id, pct.id] }],
    hypotheses: [],
    recommendations: [],
    uncertainties: [],
    follow_up_questions: [],
  };

  it("parses amounts, suffixes and percentages", () => {
    const n = extractNumbers("PKR 928.6M, 1.20B, 37.7% and 45 days on 2026-09-30 for C0006 (60x120)");
    expect(n.map((x) => x.value)).toEqual([928.6e6, 1.2e9, 37.7, 45]);
  });
  it("accepts an answer that only uses evidence numbers", () => {
    const r = checkGrounding(ok, packet);
    expect(r.grounded).toBe(true);
    expect(r.numbersChecked).toBeGreaterThanOrEqual(3);
  });
  it("rejects an invented number", () => {
    const bad = { ...ok, summary: "Overdue receivables are PKR 512.3M." };
    const r = checkGrounding(bad, packet);
    expect(r.grounded).toBe(false);
    expect(r.unverifiedNumbers).toContain("PKR 512.3M");
  });
  it("rejects a self-calculated percentage", () => {
    const bad = { ...ok, facts: [{ statement: "Overdue is 61.3% higher than last year.", evidence_ids: [od.id] }] };
    expect(checkGrounding(bad, packet).grounded).toBe(false);
  });
  it("rejects unknown evidence IDs and uncited facts", () => {
    const bad = { ...ok, facts: [{ statement: "Things are fine.", evidence_ids: ["E999"] }, { statement: "Also fine.", evidence_ids: [] }] };
    const r = checkGrounding(bad, packet);
    expect(r.issues.some((i) => i.message.includes("E999"))).toBe(true);
    expect(r.issues.some((i) => i.message.includes("at least one"))).toBe(true);
  });
  it("warns about causal claims stated as facts", () => {
    const bad = { ...ok, facts: [{ statement: `Overdue is ${od.display} because distributors are struggling.`, evidence_ids: [od.id] }] };
    const r = checkGrounding(bad, packet);
    expect(r.issues.some((i) => i.severity === "warning" && i.message.includes("Causal"))).toBe(true);
  });
});

describe("demo mode and live-mode fallbacks", () => {
  const packet = buildEvidence(model, base, "Which accounts have overdue invoices?", ["receivables_risk"]);

  it("labels demo mode honestly and stays grounded", async () => {
    const r = await answerFromEvidence(packet, { config: null });
    expect(r.mode).toBe("demo");
    expect(r.notices[0]).toContain("No AI model was called");
    expect(r.grounding.grounded).toBe(true);
  });

  it("falls back to demo mode, with a notice, when the provider fails", async () => {
    const failing = (async () => new Response("unauthorized", { status: 401 })) as typeof fetch;
    const r = await answerFromEvidence(packet, { config: { apiKey: "x", model: "m", timeoutMs: 1000 }, fetchImpl: failing });
    expect(r.mode).toBe("demo");
    expect(r.notices[0]).toContain("HTTP 401");
  });

  it("parses a structured tool response from the provider and checks it", async () => {
    const od = byKey(packet, "kpi.overdue")!;
    const fake = (async () =>
      new Response(
        JSON.stringify({
          content: [
            {
              type: "tool_use",
              name: "submit_analysis",
              input: { summary: `Overdue is ${od.display}.`, facts: [{ statement: `Overdue is ${od.display}.`, evidence_ids: [od.id] }], hypotheses: [], recommendations: [], uncertainties: [], follow_up_questions: [] },
            },
          ],
        }),
        { status: 200 },
      )) as typeof fetch;
    const r = await answerFromEvidence(packet, { config: { apiKey: "x", model: "test-model", timeoutMs: 1000 }, fetchImpl: fake });
    expect(r.mode).toBe("live");
    expect(r.model).toBe("test-model");
    expect(r.grounding.grounded).toBe(true);
  });

  it("rejects a provider response that does not match the schema", async () => {
    const fake = (async () => new Response(JSON.stringify({ content: [{ type: "tool_use", name: "submit_analysis", input: { summary: 5 } }] }), { status: 200 })) as typeof fetch;
    const msg = await explainWithClaude(packet, { apiKey: "x", model: "m", timeoutMs: 1000 }, fake).then(() => "ok", (e: Error) => e.message);
    expect(msg).toContain("expected structure");
  });

  it("produces a grounded demo answer for every analysis type", () => {
    const all = ["sales_vs_collections", "performance_drivers", "customer_concentration", "receivables_risk", "distributor_attention", "product_performance", "collection_scenario", "complaints", "forecast", "data_quality", "next_steps"] as const;
    for (const a of all) {
      const p = buildEvidence(model, base, `test ${a}`, [a]);
      const r = demoExplain(p);
      const g = checkGrounding(r, p);
      expect({ a, issues: g.issues.filter((i) => i.severity === "error") }).toEqual({ a, issues: [] });
      expect(r.facts.length).toBeGreaterThan(0);
    }
  });
});

describe("evaluation set (demo mode)", () => {
  const cases = readJson<{ cases: EvalCase[] }>("evals/questions.json").cases;
  for (const c of cases) {
    it(`${c.id}: ${c.question}`, async () => {
      const out = await runEvalCase(model, base, c, (p) => answerFromEvidence(p, { config: null }));
      expect(out.failures).toEqual([]);
    });
  }
});
