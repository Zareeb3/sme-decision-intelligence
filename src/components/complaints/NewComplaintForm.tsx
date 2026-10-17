"use client";

/**
 * Complaint intake. Checks references against company data as you type,
 * warns about possible duplicates, and prevents double submission.
 */
import { useMemo, useRef, useState } from "react";
import { Button, Notice, Panel } from "../ui";
import { areaCls, Field, inputCls } from "./shared";
import { findPossibleDuplicates } from "@/lib/complaints/workflow";
import { referenceChecker } from "@/lib/complaints/context";
import { CHANNELS, type Channel, type ComplaintCase, type NewCaseInput } from "@/lib/complaints/types";
import type { Model } from "@/lib/analytics/model";
import { formatDate, formatNumber } from "@/lib/analytics/format";
import { currencyCode } from "@/lib/analytics/format";

function newKey() {
  try {
    return crypto.randomUUID();
  } catch {
    return `${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
  }
}

export function NewComplaintForm({
  model,
  cases,
  actor,
  defaultDate,
  linkedComplaintId,
  busy,
  onCancel,
  onSubmit,
}: {
  model: Model;
  cases: ComplaintCase[];
  actor: string;
  defaultDate: string;
  linkedComplaintId: string | null;
  busy: boolean;
  onCancel: () => void;
  onSubmit: (input: NewCaseInput, triageNow: boolean) => Promise<string | null>;
}) {
  const linked = linkedComplaintId ? model.complaints.find((c) => c.complaint_id === linkedComplaintId) : undefined;
  const key = useRef(newKey());
  const [receivedDate, setReceivedDate] = useState(linked?.date_opened ?? defaultDate);
  const [channel, setChannel] = useState<Channel>("Email");
  const [customerQuery, setCustomerQuery] = useState(linked ? `${linked.customer_id} — ${model.customersById.get(linked.customer_id)?.customer_name ?? ""}` : "");
  const [notListed, setNotListed] = useState(false);
  const [customerName, setCustomerName] = useState("");
  const [orderRef, setOrderRef] = useState(linked?.order_id ?? "");
  const [invoiceRef, setInvoiceRef] = useState("");
  const [claim, setClaim] = useState(linked?.claim_value_pkr ? String(linked.claim_value_pkr) : "");
  const [contactName, setContactName] = useState("");
  const [text, setText] = useState("");
  const [supporting, setSupporting] = useState("");
  const [notDuplicate, setNotDuplicate] = useState(false);
  const [triageNow, setTriageNow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [submitting, setSubmitting] = useState(false);

  const customers = useMemo(() => [...model.customersById.values()].sort((a, b) => a.customer_name.localeCompare(b.customer_name)), [model]);
  const customerId = useMemo(() => {
    if (notListed) return null;
    const id = customerQuery.split(" — ")[0].trim();
    return model.customersById.has(id) ? id : null;
  }, [customerQuery, notListed, model]);
  const refs = useMemo(() => referenceChecker(model), [model]);
  const order = orderRef.trim() ? refs.orderBelongsTo(orderRef.trim()) : null;
  const recentOrders = useMemo(() => (customerId ? model.orders.filter((o) => o.customer_id === customerId && o.net_sales_pkr > 0).slice(-12).reverse() : []), [customerId, model]);

  const dups = useMemo(
    () => (text.trim().length >= 15 ? findPossibleDuplicates({ text, customerId, customerNameEntered: customerName, orderRef: orderRef.trim() || null, receivedDate }, cases) : []),
    [text, customerId, customerName, orderRef, receivedDate, cases],
  );

  const problems: string[] = [];
  if (!actor.trim()) problems.push("Enter your name in “Acting as” at the top of the page.");
  if (!customerId && !(notListed && customerName.trim())) problems.push("Choose a customer from the list, or tick “Customer not in the list” and enter the name.");
  if (text.trim().length < 15) problems.push("Describe the complaint (at least 15 characters).");
  if (dups.length && !notDuplicate) problems.push("Confirm this is not a duplicate of the complaint(s) listed.");
  if (claim && !(Number(claim) >= 0)) problems.push("Claim value must be a number.");

  async function submit() {
    if (problems.length || submitting) return;
    setSubmitting(true);
    setError(null);
    const input: NewCaseInput = {
      submissionKey: key.current,
      receivedDate,
      channel,
      customerId,
      customerNameEntered: customerId ? "" : customerName.trim(),
      orderRef: orderRef.trim() || null,
      productId: null,
      invoiceRef: invoiceRef.trim() || null,
      contactName: contactName.trim(),
      claimValue: claim ? Number(claim) : null,
      originalText: text,
      supportingInfo: supporting,
      linkedComplaintId: linkedComplaintId,
      createdBy: actor.trim(),
    };
    const err = await onSubmit(input, triageNow);
    if (err) setError(err);
    setSubmitting(false);
  }

  return (
    <Panel title={linked ? `Open a case for ${linked.complaint_id}` : "Record a complaint"} subtitle="The customer's words are stored exactly as entered and never changed. The AI only suggests; a person confirms every decision.">
      {linked && (
        <div className="mb-4">
          <Notice tone="primary">
            Imported record: {linked.category} on {linked.product_name}, {linked.severity} severity, opened {formatDate(linked.date_opened)}, owned by {linked.assigned_team}. Paste or type the customer&apos;s own description below.
          </Notice>
        </div>
      )}
      <div className="grid grid-cols-1 gap-4 md:grid-cols-2">
        <Field label="Received on" required>
          <input type="date" value={receivedDate} max={new Date().toISOString().slice(0, 10)} onChange={(e) => setReceivedDate(e.target.value)} className={inputCls} />
        </Field>
        <Field label="Channel" required>
          <select value={channel} onChange={(e) => setChannel(e.target.value as Channel)} className={inputCls}>
            {CHANNELS.map((c) => (
              <option key={c}>{c}</option>
            ))}
          </select>
        </Field>
        <div className="md:col-span-2">
          <Field label="Customer" required hint="Search by name or ID">
            <input list="complaint-customers" value={customerQuery} disabled={notListed || Boolean(linked)} onChange={(e) => setCustomerQuery(e.target.value)} placeholder="Start typing a customer name" className={inputCls} />
            <datalist id="complaint-customers">
              {customers.map((c) => (
                <option key={c.customer_id} value={`${c.customer_id} — ${c.customer_name}`}>
                  {c.customer_type}, {c.region}
                </option>
              ))}
            </datalist>
          </Field>
          {!linked && (
            <label className="mt-2 flex items-center gap-2 text-[0.82rem] text-muted">
              <input type="checkbox" checked={notListed} onChange={(e) => setNotListed(e.target.checked)} /> Customer not in the list (end customer, new or walk-in)
            </label>
          )}
          {notListed && (
            <div className="mt-2">
              <input value={customerName} onChange={(e) => setCustomerName(e.target.value)} placeholder="Customer name as given" className={inputCls} aria-label="Customer name" />
              <p className="mt-1 text-[0.75rem] text-faint">Saved as entered; it will not be linked to sales or receivables.</p>
            </div>
          )}
          {customerQuery && !customerId && !notListed && <p className="mt-1 text-[0.78rem] text-ochre">Not matched to a customer yet. Pick one from the suggestions.</p>}
        </div>
        <Field label="Order or delivery reference" hint="optional">
          <input list="complaint-orders" value={orderRef} disabled={Boolean(linked)} onChange={(e) => setOrderRef(e.target.value)} placeholder="e.g. SO007910" className={inputCls} />
          <datalist id="complaint-orders">
            {recentOrders.map((o) => (
              <option key={o.order_id} value={o.order_id}>
                {o.order_date} · {o.product_name} · {formatNumber(o.quantity_sqm)}
              </option>
            ))}
          </datalist>
          {order && !order.exists && <p className="mt-1 text-[0.78rem] text-ochre">Not found in sales data. It will be saved as an unverified reference.</p>}
          {order?.exists && customerId && order.customerId !== customerId && <p className="mt-1 text-[0.78rem] text-oxide">This order belongs to customer {order.customerId}. Check the reference.</p>}
          {order?.exists && (!customerId || order.customerId === customerId) && <p className="mt-1 text-[0.78rem] text-celadon">Order found: {model.ordersById.get(orderRef.trim())?.product_name}.</p>}
        </Field>
        <Field label="Invoice reference" hint="optional">
          <input value={invoiceRef} onChange={(e) => setInvoiceRef(e.target.value)} placeholder="e.g. INV007910" className={inputCls} />
        </Field>
        <Field label={`Claim value (${currencyCode()})`} hint="optional, if the customer states one">
          <input inputMode="decimal" value={claim} onChange={(e) => setClaim(e.target.value.replace(/[^\d.]/g, ""))} className={inputCls} />
        </Field>
        <Field label="Contact person" hint="optional, never sent to the AI">
          <input value={contactName} onChange={(e) => setContactName(e.target.value)} className={inputCls} />
        </Field>
        <div className="md:col-span-2">
          <Field label="Complaint, in the customer's words" required>
            <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} maxLength={6000} className={areaCls} placeholder="Paste the email or message, or write down what the customer said." />
          </Field>
          <p className="mt-1 text-right text-[0.72rem] text-faint">{text.length} / 6,000</p>
        </div>
        <div className="md:col-span-2">
          <Field label="Supporting information" hint="optional: photos received, batch codes, site details">
            <textarea value={supporting} onChange={(e) => setSupporting(e.target.value)} rows={2} className={areaCls} />
          </Field>
        </div>
      </div>

      {dups.length > 0 && (
        <div className="mt-4">
          <Notice tone="watch">
            <p className="font-medium">Possible duplicate</p>
            <ul className="mt-1 list-disc pl-5">
              {dups.slice(0, 3).map((d) => (
                <li key={d.id}>{d.reason}</li>
              ))}
            </ul>
            <label className="mt-2 flex items-center gap-2">
              <input type="checkbox" checked={notDuplicate} onChange={(e) => setNotDuplicate(e.target.checked)} /> This is a separate complaint, not a duplicate
            </label>
          </Notice>
        </div>
      )}

      <label className="mt-4 flex items-center gap-2 text-[0.85rem]">
        <input type="checkbox" checked={triageNow} onChange={(e) => setTriageNow(e.target.checked)} /> Run triage straight after saving
      </label>

      {problems.length > 0 && (
        <ul className="mt-3 list-disc pl-5 text-[0.8rem] text-muted">
          {problems.map((p) => (
            <li key={p}>{p}</li>
          ))}
        </ul>
      )}
      {error && (
        <div className="mt-3">
          <Notice tone="risk">{error}</Notice>
        </div>
      )}
      <div className="mt-4 flex flex-wrap gap-2">
        <Button onClick={() => void submit()} disabled={problems.length > 0 || submitting || busy}>
          {submitting ? "Saving…" : "Save complaint"}
        </Button>
        <Button variant="ghost" onClick={onCancel}>
          Cancel
        </Button>
      </div>
    </Panel>
  );
}
