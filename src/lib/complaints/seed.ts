/**
 * Builds the sample company's complaint register from the synthetic texts in
 * public/sample-data/complaint_texts.json.
 *
 * Every case is created and moved through the REAL workflow functions, with a
 * rule-based triage (no AI is called while seeding) and fictional staff names,
 * so the demo starts with cases at every stage: new, awaiting review, under
 * investigation, awaiting the customer, resolved and closed.
 */
import type { Model } from "../analytics/model";
import { referenceChecker } from "./context";
import { localRulesTransport, triageCase } from "./triage";
import { applyAction, createCase } from "./workflow";
import type { Taxonomy } from "./taxonomy";
import type { Channel, ComplaintCase, Priority } from "./types";

export interface SeedCase {
  id: string;
  linkedComplaintId: string | null;
  customerId: string | null;
  customerNameEntered: string;
  orderRef: string | null;
  claimValue: number | null;
  contactName: string;
  receivedDate: string;
  channel: Channel;
  text: string;
  flow: "new" | "triaged" | "investigating" | "awaiting" | "resolved" | "closed";
  reviewerDecision: { category: string; department: string; priority: Priority };
}

const STAFF: Record<string, string> = {
  Quality: "Sana Iqbal (Quality)",
  Production: "Usman Tariq (Production)",
  Logistics: "Bilal Ahmed (Logistics)",
  Commercial: "Hina Raza (Commercial)",
  Finance: "Kamran Ali (Finance)",
  "Customer Service": "Ayesha Noor (Customer Service)",
};
const COORDINATOR = "Faisal Mehmood (Complaints coordinator)";
const DIRECTOR = "Nadia Hussain (Operations Director)";

const RESOLUTION: Record<string, string> = {
  "Shade Variation": "Batch codes checked against dispatch records; affected boxes exchanged from a single matching batch after Quality inspection.",
  "Surface Defect": "Quality inspected photos and retained samples; defective tiles replaced after confirmation.",
  "Size / Calibration": "Production checked calibration records for the batch; out-of-tolerance boxes exchanged.",
  "Breakage in Transit": "Damage confirmed from the signed delivery note; broken boxes replaced and the claim lodged with the transporter.",
  "Delivery Delay": "Dispatch rescheduled and delivered; customer informed of the cause.",
  "Short Supply": "Warehouse confirmed the shortfall against the loading slip; balance quantity dispatched.",
  "Billing Discrepancy": "Invoice checked against the agreed price; corrected invoice issued after Commercial approval.",
  "Payment / Credit Note": "Ledger reconciled with Finance; statement shared with the customer.",
  "Installation / Usage": "Cleaning and maintenance guidance shared; technical visit offered.",
  "Sales & Service Conduct": "Sales manager met the customer; the commitment was reviewed with Commercial.",
  "Product Safety": "Site inspected by Quality; findings reviewed by management before any response on liability.",
};

const at = (date: string, hours: number) => new Date(Date.parse(`${date}T09:00:00Z`) + hours * 3_600_000);
const dayAfter = (date: string, days: number) => new Date(Date.parse(`${date}T00:00:00Z`) + days * 86_400_000).toISOString().slice(0, 10);

export async function buildSampleRegister(model: Model, seeds: SeedCase[], tax: Taxonomy): Promise<ComplaintCase[]> {
  const refs = referenceChecker(model);
  let cases: ComplaintCase[] = [];
  const transport = localRulesTransport(tax);
  for (const s of seeds) {
    const t0 = s.receivedDate;
    let c = createCase(
      {
        submissionKey: `sample-${s.id}`,
        receivedDate: s.receivedDate,
        channel: s.channel,
        customerId: s.linkedComplaintId ? (model.complaints.find((x) => x.complaint_id === s.linkedComplaintId)?.customer_id ?? s.customerId) : s.customerId,
        customerNameEntered: s.customerNameEntered,
        orderRef: s.linkedComplaintId ? (model.complaints.find((x) => x.complaint_id === s.linkedComplaintId)?.order_id ?? s.orderRef) : s.orderRef,
        productId: null,
        invoiceRef: null,
        contactName: s.contactName,
        claimValue: s.claimValue ?? (s.linkedComplaintId ? (model.complaints.find((x) => x.complaint_id === s.linkedComplaintId)?.claim_value_pkr ?? null) : null),
        originalText: s.text,
        supportingInfo: "",
        linkedComplaintId: s.linkedComplaintId,
        createdBy: COORDINATOR,
      },
      cases,
      refs,
      at(t0, 1),
    );
    cases = [...cases, c];
    if (s.flow === "new") continue;

    const { record } = await triageCase(model, c, tax, transport, undefined, at(t0, 2));
    c = applyAction(c, { type: "record_assessment", record }, c.version, at(t0, 2));
    if (s.flow !== "triaged") {
      const d = s.reviewerDecision;
      const floorOverride = record.rules.priorityFloor && ["Low", "Medium", "High", "Critical"].indexOf(d.priority) < ["Low", "Medium", "High", "Critical"].indexOf(record.rules.priorityFloor);
      c = applyAction(
        c,
        { type: "confirm_triage", by: COORDINATOR, category: d.category, secondaryCategory: null, priority: d.priority, department: d.department, owner: STAFF[d.department] ?? "", overrideReason: floorOverride ? "Follow-up on an existing complaint, not a new issue." : undefined },
        c.version,
        at(t0, 20),
      );
      if (c.escalation.required) c = applyAction(c, { type: "acknowledge_escalation", by: DIRECTOR, note: "Reviewed in the daily operations meeting; Quality to report findings before any commitment to the customer." }, c.version, at(t0, 24));
      c = applyAction(c, { type: "transition", by: STAFF[d.department] ?? COORDINATOR, to: "Under Investigation", note: "Investigation started." }, c.version, at(t0, 26));
      if (s.flow === "awaiting") {
        c = applyAction(c, { type: "transition", by: STAFF[d.department] ?? COORDINATOR, to: "Awaiting Customer", note: "Asked the customer for photos, batch codes and quantities." }, c.version, at(t0, 30));
      }
      if (s.flow === "resolved" || s.flow === "closed") {
        if (c.response) c = applyAction(c, { type: "approve_response", by: COORDINATOR, text: c.response.draft }, c.version, at(t0, 27));
        const imported = s.linkedComplaintId ? model.complaints.find((x) => x.complaint_id === s.linkedComplaintId) : undefined;
        const resolvedOn = imported?.date_resolved || dayAfter(t0, 5);
        c = applyAction(c, { type: "transition", by: STAFF[d.department] ?? COORDINATOR, to: "Resolved", note: RESOLUTION[d.category] ?? "Resolved with the customer." }, c.version, new Date(`${resolvedOn}T15:00:00Z`));
        if (s.flow === "closed") c = applyAction(c, { type: "transition", by: COORDINATOR, to: "Closed", note: "Customer confirmed the resolution." }, c.version, new Date(`${dayAfter(resolvedOn, 2)}T10:00:00Z`));
      }
    }
    cases = cases.map((x) => (x.id === c.id ? c : x));
  }
  return cases;
}
