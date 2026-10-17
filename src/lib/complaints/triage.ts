/**
 * Triage orchestration for one case (runs in the browser, and in tests/evals):
 *
 *   case + linked records ─► redacted request ─► /api/complaints/triage (AI or fallback)
 *        ─► deterministic business rules ─► combined suggestion ─► TriageRecord
 *
 * The record is then stored on the case through the workflow, which marks it
 * "AI Reviewed" and waits for a person to confirm.
 */
import type { Model } from "../analytics/model";
import { getRules, type BusinessRules } from "../settings";
import { buildRuleContext, buildTriageRequest } from "./context";
import { ruleBasedAssessment } from "./fallback";
import { PROMPT_VERSION, type TriageRequest, type TriageResult } from "./llm";
import { combine, evaluateRules } from "./rules";
import { canonicalLabel, UNCLEAR_CATEGORY, type Taxonomy } from "./taxonomy";
import type { ComplaintCase, TriageRecord } from "./types";

export type TriageTransport = (req: TriageRequest) => Promise<TriageResult>;

/** Calls the server route; if the server cannot be reached, falls back to rules in the browser. */
export const httpTransport =
  (tax: Taxonomy): TriageTransport =>
  async (req) => {
    try {
      const r = await fetch("/api/complaints/triage", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(req) });
      if (r.ok) return (await r.json()) as TriageResult;
      const body = (await r.json().catch(() => ({}))) as { error?: string };
      return { mode: "rules", assessment: ruleBasedAssessment(req, tax), notices: [`The triage service returned an error (${body.error ?? `HTTP ${r.status}`}). Showing a rule-based suggestion; no AI was called. You can retry.`], promptVersion: PROMPT_VERSION, aiFailed: true };
    } catch {
      return { mode: "rules", assessment: ruleBasedAssessment(req, tax), notices: ["The server could not be reached. Showing a rule-based suggestion calculated in this browser; no AI was called. You can retry."], promptVersion: PROMPT_VERSION, aiFailed: true };
    }
  };

/** Rule-based only, without any network call (used by evaluation and tests). */
export const localRulesTransport =
  (tax: Taxonomy): TriageTransport =>
  async (req) => ({ mode: "rules", assessment: ruleBasedAssessment(req, tax), notices: ["Rule-based suggestion. No AI model was called."], promptVersion: PROMPT_VERSION });

let seq = 0;

export async function triageCase(
  model: Model,
  c: ComplaintCase,
  tax: Taxonomy,
  transport: TriageTransport,
  rules: BusinessRules["complaints"] = getRules().complaints,
  now = new Date(),
): Promise<{ record: TriageRecord; aiFailed: boolean }> {
  const { request, redactions } = buildTriageRequest(model, c, tax, rules);
  const result = await transport(request);
  const category = canonicalLabel(result.assessment.primary_category, tax.categories.map((x) => x.name)) ?? UNCLEAR_CATEGORY;
  const ruleResult = evaluateRules(buildRuleContext(model, c, rules), category, rules);
  const suggestion = combine(result.assessment, ruleResult, tax);
  seq += 1;
  return {
    record: {
      id: `T-${now.getTime().toString(36)}-${seq}`,
      createdAt: now.toISOString(),
      mode: result.mode,
      model: result.model,
      promptVersion: result.promptVersion,
      assessment: result.assessment,
      rules: ruleResult,
      suggestion,
      notices: result.notices,
      sentText: request.text,
      redactions,
    },
    aiFailed: Boolean(result.aiFailed),
  };
}
