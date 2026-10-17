/**
 * Case workflow: creation, allowed status transitions and every change to a case.
 *
 * The same pure functions run on the server (company deployments) and in the
 * browser (deployments without server storage), so the rules cannot drift.
 *
 * Controls enforced here, not only in the UI:
 *  - only a named person can confirm triage, change status, approve a reply or
 *    acknowledge an escalation; the AI / system can only add assessments;
 *  - work cannot start (Under Investigation / Awaiting Customer) before a person
 *    has confirmed the category, priority and department;
 *  - resolving needs a resolution note; closing needs a resolved case;
 *  - an escalated case cannot be resolved until the escalation is acknowledged;
 *  - setting a priority below the business-rule minimum needs a written reason;
 *  - the original complaint text is never changed.
 */
import { newCaseInputSchema, priorityRank, type Actor, type CaseAction, type CaseStatus, type ComplaintCase, type NewCaseInput, type TriageRecord } from "./types";

export class WorkflowError extends Error {
  constructor(message: string, readonly code: "invalid" | "forbidden" | "conflict" | "not_found" = "invalid") {
    super(message);
  }
}

/** Transitions a person may make. "AI Reviewed" is set only by recording an assessment. */
export const TRANSITIONS: Record<CaseStatus, CaseStatus[]> = {
  New: ["Under Investigation", "Awaiting Customer"],
  "AI Reviewed": ["Under Investigation", "Awaiting Customer"],
  "Under Investigation": ["Awaiting Customer", "Resolved"],
  "Awaiting Customer": ["Under Investigation", "Resolved"],
  Resolved: ["Closed", "Under Investigation"],
  Closed: ["Under Investigation"],
};

export const OPEN_STATUSES: CaseStatus[] = ["New", "AI Reviewed", "Under Investigation", "Awaiting Customer"];
export const isOpenStatus = (s: CaseStatus) => OPEN_STATUSES.includes(s);

export function allowedTransitions(c: ComplaintCase): { to: CaseStatus; allowed: boolean; reason?: string }[] {
  return TRANSITIONS[c.status].map((to) => {
    const reason = transitionBlocker(c, to);
    return { to, allowed: !reason, reason: reason ?? undefined };
  });
}

function transitionBlocker(c: ComplaintCase, to: CaseStatus, note?: string): string | null {
  if (!TRANSITIONS[c.status].includes(to)) return `A case cannot move from ${c.status} to ${to}.`;
  if ((to === "Under Investigation" || to === "Awaiting Customer") && !c.confirmed) return "Confirm the category, priority and department first.";
  if (to === "Resolved") {
    if (c.escalation.required && !c.escalation.acknowledgedBy) return "This case is escalated: management must acknowledge it before it can be resolved.";
    if (note !== undefined && !note.trim()) return "Describe how the complaint was resolved.";
  }
  if (to === "Under Investigation" && (c.status === "Resolved" || c.status === "Closed") && note !== undefined && !note.trim()) return "Give a reason for reopening the case.";
  return null;
}

export function nextCaseId(existing: { id: string }[], year: number): string {
  const prefix = `CR-${String(year).slice(2)}-`;
  const max = existing.filter((c) => c.id.startsWith(prefix)).reduce((m, c) => Math.max(m, Number(c.id.slice(prefix.length)) || 0), 0);
  return `${prefix}${String(max + 1).padStart(4, "0")}`;
}

export interface ReferenceCheck {
  customerExists: (id: string) => boolean;
  orderBelongsTo: (orderId: string) => { exists: boolean; customerId?: string; productId?: string };
  productExists: (id: string) => boolean;
  invoiceExists: (id: string) => boolean;
}

/** Create a case from intake input. Throws WorkflowError on invalid input or a repeated submission. */
export function createCase(raw: NewCaseInput, existing: ComplaintCase[], refs: ReferenceCheck | null, now = new Date()): ComplaintCase {
  const parsed = newCaseInputSchema.safeParse(raw);
  if (!parsed.success) throw new WorkflowError(parsed.error.issues.map((i) => i.message).join(" "));
  const input = parsed.data;
  const dup = existing.find((c) => c.submissionKey === input.submissionKey);
  if (dup) throw new WorkflowError(`This complaint was already submitted as ${dup.id}.`, "conflict");
  if (input.linkedComplaintId && existing.some((c) => c.linkedComplaintId === input.linkedComplaintId)) {
    throw new WorkflowError(`Complaint ${input.linkedComplaintId} already has a case.`, "conflict");
  }
  if (input.receivedDate > now.toISOString().slice(0, 10)) throw new WorkflowError("The received date cannot be in the future.");
  if (!input.customerId && !input.customerNameEntered) throw new WorkflowError("Choose a customer or enter the customer's name.");

  const notes: string[] = [];
  let customerFound = false;
  let orderFound: boolean | null = null;
  let productFound: boolean | null = null;
  let invoiceFound: boolean | null = null;
  let productId = input.productId || null;
  if (refs) {
    customerFound = input.customerId ? refs.customerExists(input.customerId) : false;
    if (input.customerId && !customerFound) notes.push(`Customer ${input.customerId} is not in the customer master; saved as entered.`);
    if (input.orderRef) {
      const o = refs.orderBelongsTo(input.orderRef);
      orderFound = o.exists;
      if (!o.exists) notes.push(`Order ${input.orderRef} was not found in the sales data; kept as an unverified reference.`);
      else if (input.customerId && o.customerId && o.customerId !== input.customerId) notes.push(`Order ${input.orderRef} belongs to customer ${o.customerId}, not ${input.customerId}. Check the reference.`);
      if (o.exists && !productId && o.productId) {
        productId = o.productId;
        notes.push(`Product ${o.productId} taken from order ${input.orderRef}.`);
      }
    }
    if (productId) {
      productFound = refs.productExists(productId);
      if (!productFound) notes.push(`Product ${productId} is not in the sales data; kept as entered.`);
    }
    if (input.invoiceRef) {
      invoiceFound = refs.invoiceExists(input.invoiceRef);
      if (!invoiceFound) notes.push(`Invoice ${input.invoiceRef} was not found; kept as an unverified reference.`);
    }
  }
  if (!input.orderRef && !input.linkedComplaintId) notes.push("No order reference: linking to sales and invoices is limited.");

  const at = now.toISOString();
  const id = input.linkedComplaintId || nextCaseId(existing, now.getUTCFullYear());
  return {
    id,
    linkedComplaintId: input.linkedComplaintId || null,
    receivedDate: input.receivedDate,
    channel: input.channel,
    customerId: input.customerId || null,
    customerNameEntered: input.customerNameEntered,
    orderRef: input.orderRef || null,
    productId,
    invoiceRef: input.invoiceRef || null,
    contactName: input.contactName,
    claimValue: input.claimValue ?? null,
    originalText: input.originalText,
    supportingInfo: input.supportingInfo,
    references: { customerFound, orderFound, productFound, invoiceFound, notes },
    status: "New",
    assessments: [],
    lastTriageError: null,
    confirmed: null,
    escalation: { required: false, reasons: [] },
    response: null,
    resolution: null,
    history: [{ at, actor: { name: input.createdBy, kind: "person" }, kind: "created", summary: `Complaint recorded from ${input.channel.toLowerCase()}.` }],
    version: 1,
    submissionKey: input.submissionKey,
    createdAt: at,
    createdBy: input.createdBy,
    updatedAt: at,
  };
}

const personActor = (name: string): Actor => ({ name: name.trim(), kind: "person" });

/**
 * Apply one action to a case and return the updated copy.
 * `expectedVersion` protects against two people overwriting each other.
 */
export function applyAction(c: ComplaintCase, action: CaseAction, expectedVersion: number | null, now = new Date()): ComplaintCase {
  if (expectedVersion != null && expectedVersion !== c.version) {
    throw new WorkflowError(`This case was changed by someone else (version ${c.version}, you had ${expectedVersion}). Reload it and try again.`, "conflict");
  }
  const at = now.toISOString();
  const next: ComplaintCase = structuredClone(c);
  const log = (actor: Actor, kind: ComplaintCase["history"][number]["kind"], summary: string, extra: Partial<ComplaintCase["history"][number]> = {}) =>
    next.history.push({ at, actor, kind, summary, ...extra });

  switch (action.type) {
    case "record_assessment": {
      if (c.status === "Closed" || c.status === "Resolved") throw new WorkflowError("Reopen the case before running triage again.");
      const rec: TriageRecord = action.record;
      next.assessments.push(rec);
      next.lastTriageError = null;
      // An escalation recommended by the AI or the rules stays until a person acknowledges it.
      if (rec.suggestion.escalate) {
        next.escalation = { ...next.escalation, required: true, reasons: [...new Set([...next.escalation.reasons, ...rec.suggestion.escalationReasons])] };
      }
      if (!next.response || (next.response.source !== "person" && !next.response.approvedBy)) {
        next.response = { draft: rec.assessment.customer_response, source: rec.mode === "live" ? "ai" : "rules" };
      }
      const from = c.status;
      if (c.status === "New") next.status = "AI Reviewed";
      log(
        { name: rec.mode === "live" ? `AI (${rec.model ?? "model"})` : "Rule-based triage", kind: "system" },
        rec.mode === "live" ? "ai_assessment" : "rules_assessment",
        `Suggested ${rec.suggestion.category}, ${rec.suggestion.priority} priority, ${rec.suggestion.department}${rec.suggestion.escalate ? ", escalation recommended" : ""}.`,
        from !== next.status ? { from, to: next.status } : {},
      );
      break;
    }
    case "record_triage_failure": {
      next.lastTriageError = action.message;
      log({ name: "System", kind: "system" }, "triage_failed", `Triage failed: ${action.message}`);
      break;
    }
    case "confirm_triage": {
      if (c.status === "Closed") throw new WorkflowError("Reopen the case before changing its classification.");
      const latest = c.assessments[c.assessments.length - 1];
      const floor = latest?.rules.priorityFloor ?? null;
      if (floor && priorityRank(action.priority) < priorityRank(floor) && !action.overrideReason?.trim()) {
        throw new WorkflowError(`Business rules require at least ${floor} priority for this case. Give a reason to set it lower.`);
      }
      next.confirmed = {
        category: action.category,
        secondaryCategory: action.secondaryCategory,
        priority: action.priority,
        department: action.department,
        owner: action.owner,
        by: action.by.trim(),
        at,
        overrideReason: action.overrideReason?.trim() || undefined,
        agreedWithSuggestion: latest
          ? { category: latest.suggestion.category === action.category, priority: latest.suggestion.priority === action.priority, department: latest.suggestion.department === action.department }
          : undefined,
        suggestionMode: latest?.mode,
      };
      if (action.priority === "Critical" && !next.escalation.required) next.escalation = { ...next.escalation, required: true, reasons: [...next.escalation.reasons, "Critical priority set by reviewer."] };
      const changed = latest
        ? [latest.suggestion.category !== action.category && `category ${latest.suggestion.category} → ${action.category}`, latest.suggestion.priority !== action.priority && `priority ${latest.suggestion.priority} → ${action.priority}`, latest.suggestion.department !== action.department && `department ${latest.suggestion.department} → ${action.department}`].filter(Boolean)
        : [];
      log(
        personActor(action.by),
        "triage_confirmed",
        `Confirmed ${action.category}, ${action.priority} priority, ${action.department}${action.owner ? `, owner ${action.owner}` : ""}.${changed.length ? ` Changed from suggestion: ${changed.join("; ")}.` : latest ? " Suggestion accepted." : " Triaged manually."}${action.overrideReason ? ` Reason: ${action.overrideReason}` : ""}`,
      );
      break;
    }
    case "transition": {
      const blocker = transitionBlocker(c, action.to, action.to === "Resolved" || ((c.status === "Resolved" || c.status === "Closed") && action.to === "Under Investigation") ? (action.note ?? "") : undefined);
      if (blocker) throw new WorkflowError(blocker, "forbidden");
      next.status = action.to;
      if (action.to === "Resolved") next.resolution = { note: action.note!.trim(), by: action.by.trim(), at };
      if (action.to === "Under Investigation" && (c.status === "Resolved" || c.status === "Closed")) next.resolution = null;
      log(personActor(action.by), "status_changed", `${c.status} → ${action.to}${action.note ? `: ${action.note.trim()}` : ""}`, { from: c.status, to: action.to });
      break;
    }
    case "add_note": {
      log(personActor(action.by), "note", action.text.trim());
      break;
    }
    case "save_response_draft": {
      if (c.response?.approvedBy) throw new WorkflowError("The reply was already approved. Notes can still be added.");
      next.response = { draft: action.text.trim(), source: "person" };
      log(personActor(action.by), "response_drafted", "Edited the reply to the customer.");
      break;
    }
    case "approve_response": {
      if (!c.confirmed) throw new WorkflowError("Confirm the triage before approving a reply to the customer.", "forbidden");
      if (c.response?.approvedBy) throw new WorkflowError("A reply was already approved for this case.");
      next.response = { draft: action.text.trim(), source: c.response?.source ?? "person", approvedBy: action.by.trim(), approvedAt: at, approvedText: action.text.trim() };
      log(personActor(action.by), "response_approved", "Approved the reply to the customer. It was not sent automatically.");
      break;
    }
    case "acknowledge_escalation": {
      if (!c.escalation.required) throw new WorkflowError("This case is not escalated.");
      if (c.escalation.acknowledgedBy) throw new WorkflowError("The escalation was already acknowledged.");
      next.escalation = { ...c.escalation, acknowledgedBy: action.by.trim(), acknowledgedAt: at, note: action.note.trim() };
      log(personActor(action.by), "escalation_acknowledged", `Escalation acknowledged: ${action.note.trim()}`);
      break;
    }
  }
  next.version = c.version + 1;
  next.updatedAt = at;
  return next;
}

/* ------------------------------------------------------------ duplicates */

const STOP = new Set("the a an and or of to in on for with is are was were we our you your it this that have has had be been from at by as not no but they them their i my me please kindly sir".split(" "));
function tokens(s: string): Set<string> {
  return new Set(
    s
      .toLowerCase()
      .replace(/[^a-z0-9\s]/g, " ")
      .split(/\s+/)
      .filter((w) => w.length > 2 && !STOP.has(w)),
  );
}

export function similarity(a: string, b: string): number {
  const A = tokens(a), B = tokens(b);
  if (!A.size || !B.size) return 0;
  let inter = 0;
  for (const w of A) if (B.has(w)) inter++;
  return inter / Math.min(A.size, B.size);
}

/** Cases from the same customer within 30 days whose text is very similar, or that cite the same order and category. */
export function findPossibleDuplicates(
  draft: { text: string; customerId: string | null; customerNameEntered?: string; orderRef: string | null; receivedDate: string; id?: string },
  cases: ComplaintCase[],
  threshold = 0.6,
): { id: string; score: number; reason: string }[] {
  const out: { id: string; score: number; reason: string }[] = [];
  const day = (d: string) => Date.parse(`${d}T00:00:00Z`) / 86_400_000;
  for (const c of cases) {
    if (c.id === draft.id) continue;
    const sameCustomer = draft.customerId ? c.customerId === draft.customerId : Boolean(draft.customerNameEntered) && c.customerNameEntered.toLowerCase() === draft.customerNameEntered!.toLowerCase();
    if (!sameCustomer || Math.abs(day(c.receivedDate) - day(draft.receivedDate)) > 30) continue;
    const score = similarity(draft.text, c.originalText);
    if (score >= threshold) out.push({ id: c.id, score, reason: `${Math.round(score * 100)}% of the wording matches ${c.id} from the same customer.` });
    else if (draft.orderRef && c.orderRef && draft.orderRef.toLowerCase() === c.orderRef.toLowerCase()) out.push({ id: c.id, score, reason: `${c.id} is about the same order ${c.orderRef}.` });
  }
  return out.sort((a, b) => b.score - a.score);
}
