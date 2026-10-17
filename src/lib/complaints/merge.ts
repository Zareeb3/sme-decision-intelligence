/**
 * Bring the complaint register into the shared analytics model.
 *
 * - Complaints entered in the app (no imported record) are added as complaints,
 *   so Overview, Report and the AI analyst count them.
 * - For imported complaints that have a case, decisions a PERSON made in the
 *   register (confirmed category / priority / department, status changes)
 *   take precedence in this app. The imported data itself is not changed; the
 *   case view shows the source values next to the register values.
 * - AI suggestions that nobody confirmed never change imported fields; they only
 *   add the suggested priority as an unconfirmed indicator.
 */
import type { EnrichedComplaint, Model } from "../analytics/model";
import type { ComplaintStatus } from "../data/types";
import { priorityToSeverity, severityToPriority } from "./taxonomy";
import type { CaseStatus, ComplaintCase, Priority } from "./types";

export function caseStatusToComplaintStatus(s: CaseStatus): ComplaintStatus {
  return s === "Resolved" || s === "Closed" ? "Resolved" : s === "Under Investigation" || s === "Awaiting Customer" ? "In Progress" : "Open";
}

/** The priority to show for a case: confirmed by a person, else the latest suggestion. */
export function currentPriority(c: ComplaintCase): { priority: Priority | null; confirmed: boolean } {
  if (c.confirmed) return { priority: c.confirmed.priority, confirmed: true };
  const last = c.assessments[c.assessments.length - 1];
  return { priority: last?.suggestion.priority ?? null, confirmed: false };
}

export function currentCategory(c: ComplaintCase): { category: string | null; department: string | null; confirmed: boolean } {
  if (c.confirmed) return { category: c.confirmed.category, department: c.confirmed.department, confirmed: true };
  const last = c.assessments[c.assessments.length - 1];
  return { category: last?.suggestion.category ?? null, department: last?.suggestion.department ?? null, confirmed: false };
}

const personChangedStatus = (c: ComplaintCase) => c.history.some((h) => h.kind === "status_changed" && h.actor.kind === "person");

const cache = new WeakMap<Model, { cases: ComplaintCase[]; result: Model }>();

export function withCases(model: Model, cases: ComplaintCase[]): Model {
  if (!cases.length) return model;
  const hit = cache.get(model);
  if (hit && hit.cases === cases) return hit.result;

  const byLinked = new Map(cases.filter((c) => c.linkedComplaintId).map((c) => [c.linkedComplaintId!, c]));
  const merged: EnrichedComplaint[] = model.complaints.map((imp) => {
    const c = byLinked.get(imp.complaint_id);
    if (!c) return { ...imp, priority: severityToPriority(imp.severity), priorityConfirmed: false };
    const pr = currentPriority(c);
    const out: EnrichedComplaint = { ...imp, caseId: c.id, caseStatus: c.status, priority: pr.priority ?? severityToPriority(imp.severity), priorityConfirmed: pr.confirmed, escalated: c.escalation.required && !c.escalation.acknowledgedBy };
    if (c.confirmed) {
      out.category = c.confirmed.category;
      out.assigned_team = c.confirmed.department;
      out.severity = priorityToSeverity(c.confirmed.priority);
    }
    if (personChangedStatus(c)) {
      out.status = caseStatusToComplaintStatus(c.status);
      out.date_resolved = c.resolution ? c.resolution.at.slice(0, 10) : "";
    }
    return out;
  });

  for (const c of cases) {
    if (c.linkedComplaintId) continue;
    const cust = c.customerId ? model.customersById.get(c.customerId) : undefined;
    const prod = c.productId ? model.productsById.get(c.productId) : undefined;
    const cat = currentCategory(c);
    const pr = currentPriority(c);
    merged.push({
      complaint_id: c.id,
      date_opened: c.receivedDate,
      customer_id: c.customerId ?? "",
      order_id: c.orderRef ?? "",
      product_id: c.productId ?? "",
      category: cat.category ?? "Not yet classified",
      severity: priorityToSeverity(pr.priority ?? "Medium"),
      assigned_team: cat.department ?? "Unassigned",
      status: caseStatusToComplaintStatus(c.status),
      date_resolved: c.resolution ? c.resolution.at.slice(0, 10) : "",
      claim_value_pkr: c.claimValue ?? 0,
      region: cust?.region ?? "Unknown",
      channel: cust?.channel ?? "Unknown",
      product_category: prod?.product_category ?? "",
      product_name: prod?.product_name ?? (c.productId || "Product not identified"),
      caseId: c.id,
      caseStatus: c.status,
      priority: pr.priority ?? undefined,
      priorityConfirmed: pr.confirmed,
      escalated: c.escalation.required && !c.escalation.acknowledgedBy,
      origin: "register",
      customer_type: cust?.customer_type ?? "Unknown",
    });
  }
  merged.sort((a, b) => (a.date_opened < b.date_opened ? -1 : a.date_opened > b.date_opened ? 1 : 0));
  const result: Model = { ...model, complaints: merged };
  cache.set(model, { cases, result });
  return result;
}
