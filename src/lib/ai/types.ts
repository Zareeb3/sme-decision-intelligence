/**
 * Contracts between the analytics engine and the AI explanation layer.
 *
 *   question ─► router ─► analytics (deterministic) ─► EvidencePacket
 *                                                     │
 *                       LLM or demo explainer ◄───────┘
 *                                │
 *                                ▼
 *                 AnalystResponse (structured) ─► grounding check ─► UI
 *
 * The LLM never sees raw CSV rows. It only sees the evidence packet, and every
 * number it is allowed to use is in that packet with an ID such as "E7".
 */
import { z } from "zod";

export const ANALYSIS_IDS = [
  "sales_vs_collections",
  "performance_drivers",
  "customer_concentration",
  "receivables_risk",
  "distributor_attention",
  "product_performance",
  "collection_scenario",
  "complaints",
  "forecast",
  "data_quality",
  "next_steps",
] as const;
export type AnalysisId = (typeof ANALYSIS_IDS)[number];

export const ANALYSIS_LABELS: Record<AnalysisId, string> = {
  sales_vs_collections: "Sales vs collections diagnosis",
  performance_drivers: "Performance drivers by region, channel and customer",
  customer_concentration: "Customer revenue concentration",
  receivables_risk: "Receivables and overdue balances",
  distributor_attention: "Accounts needing attention (rule-based health score)",
  product_performance: "Product performance, margins and unusual months",
  collection_scenario: "Collection improvement scenario",
  complaints: "Complaints requiring attention",
  forecast: "Baseline sales forecast with backtest",
  data_quality: "Data coverage and limitations",
  next_steps: "Management priorities overview",
};

/** Which kind of method answers the question — shown to the user for transparency. */
export const ANALYSIS_METHOD: Record<AnalysisId, string> = {
  sales_vs_collections: "Descriptive + diagnostic analytics",
  performance_drivers: "Diagnostic analytics (contribution to change)",
  customer_concentration: "Descriptive analytics (shares, HHI)",
  receivables_risk: "Descriptive analytics (as-of aging)",
  distributor_attention: "Business rules (transparent scoring)",
  product_performance: "Descriptive analytics + statistical outlier test",
  collection_scenario: "Scenario calculation on explicit assumptions",
  complaints: "Descriptive analytics + count-based spike rule",
  forecast: "Baseline time-series methods with backtest",
  data_quality: "Data validation results",
  next_steps: "Combined summary of the above",
};

export const evidenceItemSchema = z.object({
  id: z.string().regex(/^E\d+$/),
  key: z.string(),
  analysis: z.enum(ANALYSIS_IDS),
  label: z.string().max(300),
  value: z.number().nullable(),
  unit: z.enum(["PKR", "%", "pts", "days", "count", "score", "text"]),
  display: z.string().max(400),
});
export type EvidenceItem = z.infer<typeof evidenceItemSchema>;

export const evidencePacketSchema = z.object({
  question: z.string().min(1).max(500),
  analyses: z.array(z.enum(ANALYSIS_IDS)).min(1).max(6),
  period: z.object({ start: z.string(), end: z.string(), asOf: z.string() }),
  filtersDescription: z.string().max(300),
  dataSource: z.string().max(200),
  items: z.array(evidenceItemSchema).max(90),
  limitations: z.array(z.string().max(400)).max(15),
});
export type EvidencePacket = z.infer<typeof evidencePacketSchema>;

const evidenceIds = z.array(z.string()).max(12);

export const analystResponseSchema = z.object({
  summary: z.string().min(1).max(800),
  facts: z.array(z.object({ statement: z.string().min(1).max(400), evidence_ids: evidenceIds })).max(10),
  hypotheses: z
    .array(z.object({ statement: z.string().min(1).max(400), evidence_ids: evidenceIds, how_to_verify: z.string().min(1).max(300) }))
    .max(6),
  recommendations: z
    .array(
      z.object({
        action: z.string().min(1).max(300),
        rationale: z.string().min(1).max(400),
        evidence_ids: evidenceIds,
        priority: z.enum(["high", "medium", "low"]),
      }),
    )
    .max(6),
  uncertainties: z.array(z.string().max(300)).max(6),
  follow_up_questions: z.array(z.string().max(200)).max(5),
});
export type AnalystResponse = z.infer<typeof analystResponseSchema>;

export interface GroundingIssue {
  severity: "error" | "warning";
  section: "summary" | "facts" | "hypotheses" | "recommendations";
  index: number;
  message: string;
}

export interface GroundingReport {
  grounded: boolean;
  numbersChecked: number;
  unverifiedNumbers: string[];
  issues: GroundingIssue[];
}

export interface AskResult {
  mode: "live" | "demo";
  /** Present in live mode. */
  model?: string;
  response: AnalystResponse;
  grounding: GroundingReport;
  /** Non-fatal problems, e.g. the live call failed and demo mode was used instead. */
  notices: string[];
}
