/**
 * Complaint register: the cases behind the complaint-triage workflow.
 *
 *   complaint received ─► AI assessment (suggestion) + business rules
 *        ─► human review (confirmed triage) ─► investigation ─► resolution ─► closure
 *
 * The imported complaints dataset (complaints.csv / SAP QMEL) is never edited.
 * A case either links to an imported complaint (`linkedComplaintId`) or is a new
 * complaint entered in the app. The customer's original text is stored once and
 * never changed; AI output is kept separately from human decisions, and every
 * change is recorded in `history`.
 */
import { z } from "zod";

export const CASE_STATUSES = ["New", "AI Reviewed", "Under Investigation", "Awaiting Customer", "Resolved", "Closed"] as const;
export type CaseStatus = (typeof CASE_STATUSES)[number];

export const PRIORITIES = ["Low", "Medium", "High", "Critical"] as const;
export type Priority = (typeof PRIORITIES)[number];

export const CHANNELS = ["Email", "Phone", "WhatsApp", "Sales visit", "Customer portal", "Letter", "Other"] as const;
export type Channel = (typeof CHANNELS)[number];

export const priorityRank = (p: Priority) => PRIORITIES.indexOf(p);
export const maxPriority = (a: Priority, b: Priority): Priority => (priorityRank(a) >= priorityRank(b) ? a : b);

/* ------------------------------------------------------------------ AI output */

/** Structured assessment returned by the language model (or the rule-based fallback). */
export const triageAssessmentSchema = z.object({
  primary_category: z.string().trim().min(1).max(60),
  secondary_category: z.string().trim().max(60).nullable(),
  issues: z.array(z.string().trim().min(1).max(200)).min(1).max(5),
  summary: z.string().trim().min(1).max(500),
  sentiment: z.enum(["Positive", "Neutral", "Negative", "Very negative"]),
  frustration: z.enum(["Low", "Medium", "High"]),
  severity: z.enum(["Low", "Medium", "High", "Critical"]),
  business_impact: z.string().trim().min(1).max(400),
  urgency: z.enum(["Low", "Medium", "High", "Immediate"]),
  response_within_hours: z.number().int().min(1).max(720),
  priority: z.enum(PRIORITIES),
  department: z.string().trim().min(1).max(40),
  next_actions: z.array(z.string().trim().min(1).max(240)).min(1).max(5),
  customer_response: z.string().trim().min(1).max(1500),
  escalate: z.boolean(),
  escalation_reason: z.string().trim().max(300).nullable(),
  safety_concern: z.boolean(),
  confidence: z.enum(["Low", "Medium", "High"]),
  confidence_reason: z.string().trim().min(1).max(400),
  missing_information: z.array(z.string().trim().min(1).max(200)).max(6),
  embedded_instructions_detected: z.boolean(),
});
export type TriageAssessment = z.infer<typeof triageAssessmentSchema>;

/* -------------------------------------------------------- deterministic rules */

export interface RuleHit {
  id: "safety" | "legal" | "retention" | "high_claim" | "key_account" | "repeat_customer" | "repeat_issue" | "systemic" | "embedded_instructions" | "personal_data";
  label: string;
  reason: string;
  /** Minimum priority this rule imposes, if any. */
  priorityFloor?: Priority;
  escalate?: boolean;
  /** Department the rule routes to, overriding the AI suggestion (used for safety only). */
  department?: string;
}

export interface RuleResult {
  hits: RuleHit[];
  priorityFloor: Priority | null;
  escalate: boolean;
  escalationReasons: string[];
  department: string | null;
}

/** What the system recommends after combining the AI assessment with the rules. */
export interface Suggestion {
  category: string;
  secondaryCategory: string | null;
  priority: Priority;
  department: string;
  escalate: boolean;
  escalationReasons: string[];
  /** Short explanation of how the priority was reached. */
  priorityExplanation: string;
}

export interface TriageRecord {
  id: string;
  createdAt: string;
  /** "live": a language model was called. "rules": the rule-based fallback; no AI was called. */
  mode: "live" | "rules";
  model?: string;
  promptVersion: string;
  assessment: TriageAssessment;
  rules: RuleResult;
  suggestion: Suggestion;
  notices: string[];
  /** What was sent to the model (after redaction), for transparency. */
  sentText?: string;
  redactions?: Record<string, number>;
}

/* ----------------------------------------------------------------- the case */

export interface Actor {
  name: string;
  kind: "person" | "system";
}

export type EventKind =
  | "created"
  | "ai_assessment"
  | "rules_assessment"
  | "triage_failed"
  | "triage_confirmed"
  | "status_changed"
  | "note"
  | "response_drafted"
  | "response_approved"
  | "escalation_acknowledged";

export interface CaseEvent {
  at: string;
  actor: Actor;
  kind: EventKind;
  summary: string;
  from?: CaseStatus;
  to?: CaseStatus;
}

export interface ConfirmedTriage {
  category: string;
  secondaryCategory: string | null;
  priority: Priority;
  department: string;
  owner: string;
  by: string;
  at: string;
  /** Reason given when the reviewer set a priority below the rule minimum. */
  overrideReason?: string;
  /** Whether the reviewer kept the system's suggestion (used to measure agreement). */
  agreedWithSuggestion?: { category: boolean; priority: boolean; department: boolean };
  /** Mode of the suggestion that was reviewed. */
  suggestionMode?: TriageRecord["mode"];
}

export interface ComplaintCase {
  id: string;
  /** Imported complaint this case belongs to, if any. */
  linkedComplaintId: string | null;
  receivedDate: string;
  channel: Channel;
  customerId: string | null;
  /** Free-text customer name when the customer is not in the customer master. */
  customerNameEntered: string;
  orderRef: string | null;
  productId: string | null;
  invoiceRef: string | null;
  contactName: string;
  claimValue: number | null;
  /** The customer's statement exactly as received. Never modified after creation. */
  originalText: string;
  supportingInfo: string;
  /** Reference checks at intake. */
  references: { customerFound: boolean; orderFound: boolean | null; productFound: boolean | null; invoiceFound: boolean | null; notes: string[] };
  status: CaseStatus;
  assessments: TriageRecord[];
  lastTriageError: string | null;
  confirmed: ConfirmedTriage | null;
  escalation: { required: boolean; reasons: string[]; acknowledgedBy?: string; acknowledgedAt?: string; note?: string };
  response: { draft: string; source: "ai" | "rules" | "person"; approvedBy?: string; approvedAt?: string; approvedText?: string } | null;
  resolution: { note: string; by: string; at: string } | null;
  history: CaseEvent[];
  version: number;
  submissionKey: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
}

const ruleHitSchema = z.object({
  id: z.enum(["safety", "legal", "retention", "high_claim", "key_account", "repeat_customer", "repeat_issue", "systemic", "embedded_instructions", "personal_data"]),
  label: z.string().max(80),
  reason: z.string().max(400),
  priorityFloor: z.enum(PRIORITIES).optional(),
  escalate: z.boolean().optional(),
  department: z.string().max(40).optional(),
});

/** Validates assessment records arriving at the server (they are built in the browser). */
export const triageRecordSchema = z.object({
  id: z.string().min(1).max(60),
  createdAt: z.string().max(40),
  mode: z.enum(["live", "rules"]),
  model: z.string().max(80).optional(),
  promptVersion: z.string().max(20),
  assessment: triageAssessmentSchema,
  rules: z.object({
    hits: z.array(ruleHitSchema).max(12),
    priorityFloor: z.enum(PRIORITIES).nullable(),
    escalate: z.boolean(),
    escalationReasons: z.array(z.string().max(400)).max(12),
    department: z.string().max(40).nullable(),
  }),
  suggestion: z.object({
    category: z.string().max(60),
    secondaryCategory: z.string().max(60).nullable(),
    priority: z.enum(PRIORITIES),
    department: z.string().max(40),
    escalate: z.boolean(),
    escalationReasons: z.array(z.string().max(400)).max(12),
    priorityExplanation: z.string().max(600),
  }),
  notices: z.array(z.string().max(500)).max(8),
  sentText: z.string().max(7000).optional(),
  redactions: z.record(z.string(), z.number()).optional(),
});

/* --------------------------------------------------------- intake and actions */

const optionalText = (max: number) => z.string().trim().max(max).optional().default("");

export const newCaseInputSchema = z.object({
  submissionKey: z.string().trim().min(8).max(80),
  receivedDate: z.string().regex(/^\d{4}-\d{2}-\d{2}$/, "Use a valid date"),
  channel: z.enum(CHANNELS),
  customerId: z.string().trim().max(40).nullable().optional().default(null),
  customerNameEntered: optionalText(120),
  orderRef: z.string().trim().max(40).nullable().optional().default(null),
  productId: z.string().trim().max(40).nullable().optional().default(null),
  invoiceRef: z.string().trim().max(40).nullable().optional().default(null),
  contactName: optionalText(120),
  claimValue: z.number().min(0).max(1e12).nullable().optional().default(null),
  originalText: z.string().trim().min(15, "Describe the complaint in at least a sentence (15 characters).").max(6000, "Complaint text is limited to 6,000 characters."),
  supportingInfo: optionalText(2000),
  linkedComplaintId: z.string().trim().max(40).nullable().optional().default(null),
  createdBy: z.string().trim().min(1, "Enter your name").max(80),
});
export type NewCaseInput = z.input<typeof newCaseInputSchema>;

const person = z.string().trim().min(1, "Enter your name").max(80);

export const caseActionSchema = z.discriminatedUnion("type", [
  z.object({ type: z.literal("record_assessment"), record: triageRecordSchema }),
  z.object({ type: z.literal("record_triage_failure"), message: z.string().max(500) }),
  z.object({
    type: z.literal("confirm_triage"),
    by: person,
    category: z.string().trim().min(1).max(60),
    secondaryCategory: z.string().trim().max(60).nullable(),
    priority: z.enum(PRIORITIES),
    department: z.string().trim().min(1).max(40),
    owner: z.string().trim().max(80),
    overrideReason: z.string().trim().max(400).optional(),
  }),
  z.object({ type: z.literal("transition"), by: person, to: z.enum(CASE_STATUSES), note: z.string().trim().max(1000).optional() }),
  z.object({ type: z.literal("add_note"), by: person, text: z.string().trim().min(1).max(2000) }),
  z.object({ type: z.literal("save_response_draft"), by: person, text: z.string().trim().min(1).max(3000) }),
  z.object({ type: z.literal("approve_response"), by: person, text: z.string().trim().min(1).max(3000) }),
  z.object({ type: z.literal("acknowledge_escalation"), by: person, note: z.string().trim().min(1, "Add a short note on what management decided").max(1000) }),
]);
export type CaseAction = z.infer<typeof caseActionSchema>;
