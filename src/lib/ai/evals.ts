/**
 * Evaluation harness for the AI Business Analyst.
 *
 * A case passes when:
 *  - routing selects every expected analysis,
 *  - the evidence packet contains every required item,
 *  - each numeric check on the evidence holds,
 *  - the explanation passes the grounding check (no unverified numbers,
 *    valid evidence IDs, every fact cites evidence),
 *  - expected sections (hypotheses / recommendations) are present.
 */
import type { Filters } from "../analytics/filters";
import type { Model } from "../analytics/model";
import { buildEvidence, byKey } from "./evidence";
import { routeQuestion } from "./router";
import type { AskResult, AnalysisId, EvidencePacket } from "./types";

export interface EvalCheck {
  key: string;
  op: ">" | "<" | ">=" | "<=" | "==";
  value?: number;
  ref?: string;
}

export interface EvalCase {
  id: string;
  question: string;
  expectedAnalyses: AnalysisId[];
  requiredEvidence: string[];
  checks: EvalCheck[];
  expectHypotheses?: boolean;
  expectRecommendations?: boolean;
  expectFallback?: boolean;
  expectedFilters?: Partial<Filters>;
  expectedScenarioPct?: number;
}

export interface EvalOutcome {
  id: string;
  question: string;
  passed: boolean;
  mode: AskResult["mode"];
  failures: string[];
  warnings: string[];
  analyses: AnalysisId[];
  evidenceItems: number;
  numbersChecked: number;
}

export function prepare(model: Model, base: Filters, question: string): { packet: EvidencePacket; filters: Filters; route: ReturnType<typeof routeQuestion> } {
  const route = routeQuestion(question, model);
  const filters = { ...base, ...route.filterOverrides };
  const packet = buildEvidence(model, filters, question, route.analyses, { scenarioPct: route.scenarioPct });
  return { packet, filters, route };
}

const compare = (a: number, op: EvalCheck["op"], b: number) =>
  op === ">" ? a > b : op === "<" ? a < b : op === ">=" ? a >= b : op === "<=" ? a <= b : Math.abs(a - b) < 1e-6;

export async function runEvalCase(
  model: Model,
  base: Filters,
  c: EvalCase,
  answer: (p: EvidencePacket) => Promise<AskResult>,
): Promise<EvalOutcome> {
  const failures: string[] = [];
  const { packet, filters, route } = prepare(model, base, c.question);

  for (const a of c.expectedAnalyses) if (!route.analyses.includes(a)) failures.push(`routing: expected analysis "${a}", got [${route.analyses.join(", ")}]`);
  if (c.expectFallback !== undefined && route.fallback !== c.expectFallback) failures.push(`routing: expected fallback=${c.expectFallback}`);
  if (c.expectedFilters?.regions && JSON.stringify(filters.regions) !== JSON.stringify(c.expectedFilters.regions)) {
    failures.push(`filters: expected regions ${JSON.stringify(c.expectedFilters.regions)}, got ${JSON.stringify(filters.regions)}`);
  }
  if (c.expectedScenarioPct !== undefined && route.scenarioPct !== c.expectedScenarioPct) failures.push(`scenario: expected ${c.expectedScenarioPct}%, got ${route.scenarioPct}%`);

  for (const k of c.requiredEvidence) if (!byKey(packet, k)) failures.push(`evidence: missing "${k}"`);
  for (const ch of c.checks) {
    const item = byKey(packet, ch.key);
    const ref = ch.ref ? byKey(packet, ch.ref)?.value : ch.value;
    if (!item || item.value === null || ref === undefined || ref === null) {
      failures.push(`check: cannot evaluate ${ch.key} ${ch.op} ${ch.ref ?? ch.value}`);
      continue;
    }
    if (!compare(item.value, ch.op, ref)) failures.push(`check: ${ch.key} = ${item.value.toFixed(2)} is not ${ch.op} ${ref}`);
  }

  const result = await answer(packet);
  if (!result.grounding.grounded) {
    for (const i of result.grounding.issues.filter((x) => x.severity === "error")) failures.push(`grounding: ${i.section}[${i.index}] ${i.message}`);
  }
  if (result.response.facts.length === 0) failures.push("answer: no facts were stated");
  if (c.expectHypotheses && result.response.hypotheses.length === 0) failures.push("answer: expected at least one hypothesis");
  if (c.expectRecommendations && result.response.recommendations.length === 0) failures.push("answer: expected at least one recommendation");

  return {
    id: c.id,
    question: c.question,
    passed: failures.length === 0,
    mode: result.mode,
    failures,
    warnings: [...result.grounding.issues.filter((i) => i.severity === "warning").map((i) => `${i.section}[${i.index}] ${i.message}`), ...result.notices.filter((n) => !n.startsWith("Demo mode"))],
    analyses: route.analyses,
    evidenceItems: packet.items.length,
    numbersChecked: result.grounding.numbersChecked,
  };
}
