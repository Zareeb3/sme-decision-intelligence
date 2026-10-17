/**
 * Evaluation of complaint triage against hand-labelled cases (evals/complaint_triage.json).
 *
 * Each case runs through the full pipeline used in the app: redaction, the
 * triage call (live model or rule-based fallback), the deterministic business
 * rules and the combined suggestion. The suggestion is compared with the
 * expected labels.
 *
 * Metrics:
 *  - primary category: accuracy (strict and with acceptable alternatives) and
 *    per-category precision / recall / F1 (strict), with support;
 *  - department accuracy; priority exact and within one level;
 *  - escalation precision and recall; safety recall; embedded-instruction recall;
 *  - duplicate detection on cases marked as duplicates.
 * The set is small and synthetic: treat the numbers as a regression check, not
 * as an estimate of real-world accuracy.
 */
import type { Model } from "../analytics/model";
import { referenceChecker } from "./context";
import { triageCase, type TriageTransport } from "./triage";
import { createCase, findPossibleDuplicates } from "./workflow";
import { PRIORITIES, type Channel, type ComplaintCase, type Priority, type TriageRecord } from "./types";
import type { Taxonomy } from "./taxonomy";

export interface TriageEvalCase {
  id: string;
  tags: string[];
  linkedComplaintId?: string;
  customerId?: string;
  customerNameEntered?: string;
  orderRef?: string;
  claimValue?: number;
  contactName?: string;
  receivedDate: string;
  channel: Channel;
  text: string;
  duplicateOf?: string;
  expected: {
    category: string;
    acceptable?: string[];
    department: string;
    acceptableDepartments?: string[];
    priority: Priority;
    escalate: boolean;
    safety: boolean;
    embeddedInstructions?: boolean;
  };
}

export interface CaseOutcome {
  id: string;
  tags: string[];
  expected: TriageEvalCase["expected"];
  got: { category: string; secondary: string | null; department: string; priority: Priority; escalate: boolean; safety: boolean; embedded: boolean; confidence: string; mode: TriageRecord["mode"]; rules: string[] };
  categoryStrict: boolean;
  categoryLenient: boolean;
  department: boolean;
  priorityExact: boolean;
  priorityWithinOne: boolean;
  notices: string[];
}

export interface TriageEvalReport {
  mode: string;
  n: number;
  outcomes: CaseOutcome[];
  categoryAccuracyStrict: number;
  categoryAccuracyLenient: number;
  departmentAccuracy: number;
  priorityExact: number;
  priorityWithinOne: number;
  escalation: { tp: number; fp: number; fn: number; precision: number | null; recall: number | null };
  safety: { cases: number; detected: number };
  embedded: { cases: number; detected: number };
  duplicates: { cases: number; detected: number };
  perCategory: { category: string; support: number; predicted: number; precision: number | null; recall: number | null; f1: number | null }[];
  macroF1: { value: number | null; categories: number };
  aiFailures: number;
}

const ratio = (a: number, b: number) => (b ? a / b : null);

export function toCase(e: TriageEvalCase, model: Model, existing: ComplaintCase[] = []): ComplaintCase {
  const imported = e.linkedComplaintId ? model.complaints.find((c) => c.complaint_id === e.linkedComplaintId) : undefined;
  return createCase(
    {
      submissionKey: `eval-${e.id}`,
      receivedDate: e.receivedDate,
      channel: e.channel,
      customerId: imported?.customer_id ?? e.customerId ?? null,
      customerNameEntered: e.customerNameEntered ?? "",
      orderRef: imported?.order_id ?? e.orderRef ?? null,
      productId: null,
      invoiceRef: null,
      contactName: e.contactName ?? "",
      claimValue: e.claimValue ?? imported?.claim_value_pkr ?? null,
      originalText: e.text,
      supportingInfo: "",
      linkedComplaintId: e.linkedComplaintId ?? null,
      createdBy: "Evaluation",
    },
    existing,
    referenceChecker(model),
    new Date(`${e.receivedDate}T12:00:00Z`),
  );
}

export async function evaluateTriage(model: Model, cases: TriageEvalCase[], tax: Taxonomy, transport: TriageTransport, mode: string): Promise<TriageEvalReport> {
  const outcomes: CaseOutcome[] = [];
  const created: ComplaintCase[] = [];
  let aiFailures = 0;
  for (const e of cases) {
    const c = toCase(e, model, created);
    created.push(c);
    const { record, aiFailed } = await triageCase(model, c, tax, transport);
    if (aiFailed) aiFailures += 1;
    const s = record.suggestion;
    const embedded = record.assessment.embedded_instructions_detected || record.rules.hits.some((h) => h.id === "embedded_instructions");
    const safety = record.assessment.safety_concern || record.rules.hits.some((h) => h.id === "safety");
    const pi = PRIORITIES.indexOf(s.priority), pe = PRIORITIES.indexOf(e.expected.priority);
    outcomes.push({
      id: e.id,
      tags: e.tags,
      expected: e.expected,
      got: { category: s.category, secondary: s.secondaryCategory, department: s.department, priority: s.priority, escalate: s.escalate, safety, embedded, confidence: record.assessment.confidence, mode: record.mode, rules: record.rules.hits.map((h) => h.id) },
      categoryStrict: s.category === e.expected.category,
      categoryLenient: s.category === e.expected.category || (e.expected.acceptable ?? []).includes(s.category),
      department: s.department === e.expected.department || (e.expected.acceptableDepartments ?? []).includes(s.department),
      priorityExact: pi === pe,
      priorityWithinOne: Math.abs(pi - pe) <= 1,
      notices: record.notices,
    });
  }

  const n = outcomes.length;
  const tp = outcomes.filter((o) => o.got.escalate && o.expected.escalate).length;
  const fp = outcomes.filter((o) => o.got.escalate && !o.expected.escalate).length;
  const fn = outcomes.filter((o) => !o.got.escalate && o.expected.escalate).length;

  const cats = [...new Set(outcomes.flatMap((o) => [o.expected.category, o.got.category]))].sort();
  const perCategory = cats.map((cat) => {
    const support = outcomes.filter((o) => o.expected.category === cat).length;
    const predicted = outcomes.filter((o) => o.got.category === cat).length;
    const correct = outcomes.filter((o) => o.got.category === cat && o.expected.category === cat).length;
    const precision = ratio(correct, predicted);
    const recall = ratio(correct, support);
    const f1 = precision !== null && recall !== null && precision + recall > 0 ? (2 * precision * recall) / (precision + recall) : precision === 0 || recall === 0 ? 0 : null;
    return { category: cat, support, predicted, precision, recall, f1 };
  });
  const meaningful = perCategory.filter((p) => p.support >= 3 && p.f1 !== null);

  // Duplicate detection: is the earlier case found when the duplicate arrives?
  const dupCases = cases.filter((c) => c.duplicateOf);
  let dupFound = 0;
  for (const d of dupCases) {
    const target = created[cases.findIndex((c) => c.id === d.duplicateOf)];
    const self = created[cases.findIndex((c) => c.id === d.id)];
    const hits = findPossibleDuplicates({ text: self.originalText, customerId: self.customerId, orderRef: self.orderRef, receivedDate: self.receivedDate, id: self.id }, created.filter((c) => c.id !== self.id));
    if (target && hits.some((h) => h.id === target.id)) dupFound += 1;
  }

  return {
    mode,
    n,
    outcomes,
    categoryAccuracyStrict: outcomes.filter((o) => o.categoryStrict).length / n,
    categoryAccuracyLenient: outcomes.filter((o) => o.categoryLenient).length / n,
    departmentAccuracy: outcomes.filter((o) => o.department).length / n,
    priorityExact: outcomes.filter((o) => o.priorityExact).length / n,
    priorityWithinOne: outcomes.filter((o) => o.priorityWithinOne).length / n,
    escalation: { tp, fp, fn, precision: ratio(tp, tp + fp), recall: ratio(tp, tp + fn) },
    safety: { cases: outcomes.filter((o) => o.expected.safety).length, detected: outcomes.filter((o) => o.expected.safety && o.got.safety).length },
    embedded: { cases: outcomes.filter((o) => o.expected.embeddedInstructions).length, detected: outcomes.filter((o) => o.expected.embeddedInstructions && o.got.embedded).length },
    duplicates: { cases: dupCases.length, detected: dupFound },
    perCategory,
    macroF1: { value: meaningful.length ? meaningful.reduce((s, p) => s + p.f1!, 0) / meaningful.length : null, categories: meaningful.length },
    aiFailures,
  };
}

const pct = (x: number | null) => (x === null ? "n/a" : `${(x * 100).toFixed(0)}%`);

export function reportMarkdown(r: TriageEvalReport, meta: { date: string; model?: string }): string {
  const lines = [
    `# Complaint triage evaluation (${r.mode})`,
    "",
    `Run: ${meta.date}${meta.model ? ` · model: ${meta.model}` : ""} · cases: ${r.n} (evals/complaint_triage.json)`,
    "",
    r.mode.startsWith("rules")
      ? "> **Rule-based fallback, no AI model was called.** The keyword rules and the expected labels were written by the same author, so these results are optimistic for the fallback. They are a baseline and a regression check, not a measure of AI quality."
      : "> Live language-model triage combined with the deterministic business rules, exactly as in the app.",
    "",
    "> The set is small (36 cases) and synthetic. Categories with fewer than 3 examples are listed but excluded from macro-F1. Treat all figures as indicative only.",
    "",
    "## Summary",
    "",
    "| Measure | Result |",
    "|---|---|",
    `| Primary category, exact | ${pct(r.categoryAccuracyStrict)} |`,
    `| Primary category, exact or acceptable alternative | ${pct(r.categoryAccuracyLenient)} |`,
    `| Macro-F1 (categories with 3+ cases: ${r.macroF1.categories}) | ${r.macroF1.value === null ? "n/a" : r.macroF1.value.toFixed(2)} |`,
    `| Department | ${pct(r.departmentAccuracy)} |`,
    `| Priority, exact | ${pct(r.priorityExact)} |`,
    `| Priority, within one level | ${pct(r.priorityWithinOne)} |`,
    `| Escalation recall (escalations found) | ${pct(r.escalation.recall)} (${r.escalation.tp} of ${r.escalation.tp + r.escalation.fn}) |`,
    `| Escalation precision | ${pct(r.escalation.precision)} (${r.escalation.fp} unnecessary) |`,
    `| Safety cases detected | ${r.safety.detected} of ${r.safety.cases} |`,
    `| Embedded instructions detected | ${r.embedded.detected} of ${r.embedded.cases} |`,
    `| Duplicates detected | ${r.duplicates.detected} of ${r.duplicates.cases} |`,
    ...(r.aiFailures ? [`| AI calls that failed (fallback used) | ${r.aiFailures} |`] : []),
    "",
    "## Per category (exact primary category)",
    "",
    "| Category | Support | Predicted | Precision | Recall | F1 |",
    "|---|---:|---:|---:|---:|---:|",
    ...r.perCategory.map((p) => `| ${p.category}${p.support < 3 ? " *(n<3)*" : ""} | ${p.support} | ${p.predicted} | ${pct(p.precision)} | ${pct(p.recall)} | ${p.f1 === null ? "n/a" : p.f1.toFixed(2)} |`),
    "",
    "## Cases",
    "",
    "| Case | Tags | Expected | Suggested | Priority (exp → got) | Escalate (exp/got) | OK |",
    "|---|---|---|---|---|---|---|",
    ...r.outcomes.map(
      (o) =>
        `| ${o.id} | ${o.tags.join(", ")} | ${o.expected.category} / ${o.expected.department} | ${o.got.category} / ${o.got.department} | ${o.expected.priority} → ${o.got.priority} | ${o.expected.escalate ? "yes" : "no"} / ${o.got.escalate ? "yes" : "no"} | ${o.categoryLenient && o.department && o.priorityWithinOne && o.got.escalate === o.expected.escalate ? "✓" : "✗"} |`,
    ),
    "",
  ];
  return lines.join("\n");
}
