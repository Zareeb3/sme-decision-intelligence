"use client";

/**
 * One complaint: the customer's original words, the AI (or rule-based)
 * suggestion, the business rules that fired, linked company records, the
 * human decisions and the full history.
 */
import { useEffect, useMemo, useState, type ReactNode } from "react";
import { Badge, Button, Notice, Panel } from "../ui";
import { areaCls, EscalatedBadge, Field, inputCls, MachineLabel, PriorityBadge, StatusBadge, type ActResult } from "./shared";
import { linkedRecords } from "@/lib/complaints/context";
import { findCommitments } from "@/lib/complaints/llm";
import { currentPriority } from "@/lib/complaints/merge";
import { allowedTransitions, findPossibleDuplicates, isOpenStatus } from "@/lib/complaints/workflow";
import { CASE_STATUSES, PRIORITIES, priorityRank, type CaseAction, type ComplaintCase, type Priority, type TriageRecord } from "@/lib/complaints/types";
import type { Taxonomy } from "@/lib/complaints/taxonomy";
import type { Model } from "@/lib/analytics/model";
import { formatDate, formatMoney, formatNumber, formatSignedPct } from "@/lib/analytics/format";

const when = (iso: string) => {
  const d = new Date(iso);
  return `${formatDate(iso.slice(0, 10))} ${d.toISOString().slice(11, 16)} UTC`;
};

export function CaseDetail({
  c,
  model,
  baseModel,
  cases,
  tax,
  actor,
  busy,
  aiConfigured,
  onBack,
  onOpen,
  act,
  runTriage,
}: {
  c: ComplaintCase;
  model: Model;
  baseModel: Model;
  cases: ComplaintCase[];
  tax: Taxonomy;
  actor: string;
  busy: string | null;
  aiConfigured: boolean | null;
  onBack: () => void;
  onOpen: (id: string) => void;
  act: (c: ComplaintCase, a: CaseAction) => Promise<ActResult>;
  runTriage: (c: ComplaintCase) => Promise<ActResult & { aiFailed?: boolean }>;
}) {
  const [message, setMessage] = useState<{ tone: "good" | "risk" | "watch"; text: string } | null>(null);
  const latest: TriageRecord | undefined = c.assessments[c.assessments.length - 1];
  const links = useMemo(() => linkedRecords(model, c, baseModel), [model, c, baseModel]);
  const dups = useMemo(() => findPossibleDuplicates({ text: c.originalText, customerId: c.customerId, customerNameEntered: c.customerNameEntered, orderRef: c.orderRef, receivedDate: c.receivedDate, id: c.id }, cases), [c, cases]);
  const pr = currentPriority(c);
  const customerName = links.customer?.customer_name ?? (c.customerNameEntered || c.customerId || "Unknown customer");
  const needActor = !actor.trim();

  async function run(a: CaseAction, success: string) {
    if (needActor && a.type !== "record_assessment") {
      setMessage({ tone: "risk", text: "Enter your name in “Acting as” at the top of the page first. It is recorded with every decision." });
      return false;
    }
    const r = await act(c, a);
    setMessage(r.ok ? { tone: "good", text: success } : { tone: "risk", text: r.message ?? "The change could not be saved." });
    return r.ok;
  }

  async function triage() {
    setMessage(null);
    const r = await runTriage(c);
    if (!r.ok) setMessage({ tone: "risk", text: r.message ?? "Triage could not be saved." });
    else if (r.aiFailed) setMessage({ tone: "watch", text: "The AI call failed, so a rule-based suggestion was recorded. You can retry." });
    else setMessage({ tone: "good", text: "Suggestion recorded. Review it and confirm the triage below." });
  }

  return (
    <div>
      <button type="button" onClick={onBack} className="mb-3 text-[0.85rem] text-glaze hover:underline">
        ← Back to the queue
      </button>
      <div className="mb-5 flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[1.5rem] font-semibold leading-tight">
            {c.id} <span className="font-normal text-muted">· {customerName}</span>
          </h1>
          <p className="mt-1 text-[0.85rem] text-muted">
            Received {formatDate(c.receivedDate)} by {c.channel.toLowerCase()} · recorded by {c.createdBy}
            {c.linkedComplaintId && c.linkedComplaintId !== c.id ? ` · imported complaint ${c.linkedComplaintId}` : c.linkedComplaintId ? " · linked to the imported complaint record" : ""}
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <StatusBadge status={c.status} />
          <PriorityBadge priority={pr.priority} confirmed={pr.confirmed} />
          {c.escalation.required && !c.escalation.acknowledgedBy && <EscalatedBadge />}
        </div>
      </div>
      <Stepper status={c.status} />
      {message && (
        <div className="mt-4" role="status">
          <Notice tone={message.tone}>{message.text}</Notice>
        </div>
      )}

      <div className="mt-5 grid grid-cols-1 gap-6 xl:grid-cols-[1.55fr_1fr]">
        <div className="min-w-0 space-y-6">
          <Panel title="Customer statement" subtitle="Original text, exactly as received. It is never edited; everything below is interpretation.">
            <blockquote className="whitespace-pre-wrap border-l-4 border-line-strong pl-4 text-[0.95rem] leading-relaxed text-ink">{c.originalText}</blockquote>
            {c.supportingInfo && <p className="mt-3 text-[0.85rem] text-muted"><span className="font-medium text-ink">Supporting information: </span>{c.supportingInfo}</p>}
            <dl className="mt-4 grid grid-cols-2 gap-x-4 gap-y-1 text-[0.8rem] sm:grid-cols-4">
              <Meta label="Order">{c.orderRef ?? "—"}</Meta>
              <Meta label="Invoice">{c.invoiceRef ?? "—"}</Meta>
              <Meta label="Claim">{c.claimValue != null ? formatMoney(c.claimValue, { precise: true }) : "—"}</Meta>
              <Meta label="Contact">{c.contactName || "—"}</Meta>
            </dl>
            {c.references.notes.length > 0 && (
              <ul className="mt-3 space-y-1 text-[0.78rem] text-ochre">
                {c.references.notes.map((n) => (
                  <li key={n}>• {n}</li>
                ))}
              </ul>
            )}
            {dups.length > 0 && (
              <div className="mt-3">
                <Notice tone="watch">
                  Possible duplicate:{" "}
                  {dups.slice(0, 3).map((d, i) => (
                    <span key={d.id}>
                      {i > 0 && "; "}
                      <button type="button" className="font-medium underline" onClick={() => onOpen(d.id)}>
                        {d.id}
                      </button>{" "}
                      ({d.reason})
                    </span>
                  ))}
                </Notice>
              </div>
            )}
          </Panel>

          <AssessmentPanel c={c} latest={latest} busy={busy} aiConfigured={aiConfigured} onTriage={triage} />

          <ReviewPanel key={`review-${c.version}`} c={c} latest={latest} tax={tax} busy={busy} onConfirm={(a) => run({ ...(a as Extract<CaseAction, { type: "confirm_triage" }>), by: actor }, "Triage confirmed and recorded in the history.")} />

          {c.escalation.required && <EscalationPanel c={c} busy={busy} onAck={(note) => run({ type: "acknowledge_escalation", by: actor, note }, "Escalation acknowledged.")} />}

          <ResponsePanel key={`resp-${c.version}`} c={c} busy={busy} onSave={(text) => run({ type: "save_response_draft", by: actor, text }, "Draft saved.")} onApprove={(text) => run({ type: "approve_response", by: actor, text }, "Reply approved. It has not been sent; copy it into your email or messaging tool.")} />

          <StatusPanel key={`status-${c.version}`} c={c} busy={busy} onMove={(to, note) => run({ type: "transition", by: actor, to, note }, `Status changed to ${to}.`)} onNote={(text) => run({ type: "add_note", by: actor, text }, "Note added.")} />
        </div>

        <div className="min-w-0 space-y-6">
          <LinkedRecordsPanel links={links} onOpen={onOpen} cases={cases} />
          <Panel title="History" subtitle="Every assessment, decision and status change, oldest first.">
            <ol className="relative space-y-3 border-l border-line pl-4">
              {c.history.map((h, i) => (
                <li key={i} className="text-[0.82rem]">
                  <span className={`absolute -left-[5px] mt-1.5 h-2.5 w-2.5 rounded-full ${h.actor.kind === "person" ? "bg-glaze" : "bg-ochre"}`} aria-hidden />
                  <p className="text-[0.74rem] text-faint">
                    {when(h.at)} · {h.actor.name}
                    {h.actor.kind === "system" ? " (automated)" : ""}
                  </p>
                  <p className="mt-0.5 text-ink">{h.summary}</p>
                </li>
              ))}
            </ol>
          </Panel>
        </div>
      </div>
    </div>
  );
}

function Meta({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-faint">{label}</dt>
      <dd className="truncate text-ink">{children}</dd>
    </div>
  );
}

function Stepper({ status }: { status: ComplaintCase["status"] }) {
  const idx = CASE_STATUSES.indexOf(status);
  return (
    <ol className="flex flex-wrap gap-1.5 text-[0.74rem]" aria-label="Workflow">
      {CASE_STATUSES.map((s, i) => (
        <li key={s} className={`rounded-full border px-2.5 py-1 ${i === idx ? "border-glaze bg-glaze text-white" : i < idx ? "border-glaze/30 bg-glaze-soft text-glaze-deep" : "border-line text-faint"}`} aria-current={i === idx ? "step" : undefined}>
          {s}
        </li>
      ))}
    </ol>
  );
}

function AssessmentPanel({ c, latest, busy, aiConfigured, onTriage }: { c: ComplaintCase; latest?: TriageRecord; busy: string | null; aiConfigured: boolean | null; onTriage: () => void }) {
  const [showSent, setShowSent] = useState(false);
  const canRun = isOpenStatus(c.status);
  const a = latest?.assessment;
  return (
    <Panel
      title="Triage suggestion"
      subtitle={latest ? `Recorded ${when(latest.createdAt)}. ${c.assessments.length > 1 ? `${c.assessments.length} assessments so far; the latest is shown.` : ""}` : "No suggestion yet."}
      actions={
        canRun ? (
          <Button variant={latest ? "secondary" : "primary"} onClick={onTriage} disabled={busy === "triage"}>
            {busy === "triage" ? "Analysing…" : latest ? (c.lastTriageError ? "Retry AI triage" : "Run triage again") : aiConfigured ? "Run AI triage" : "Run triage"}
          </Button>
        ) : undefined
      }
    >
      {busy === "triage" && <p className="mb-3 text-[0.85rem] text-muted" role="status">Removing names and contact details, then requesting a structured assessment…</p>}
      {c.lastTriageError && (
        <div className="mb-3">
          <Notice tone="watch">{c.lastTriageError}</Notice>
        </div>
      )}
      {!latest && (
        <div className="space-y-2 text-[0.85rem] text-muted">
          <p>
            {aiConfigured
              ? "Run triage to get a suggested category, priority, department, next steps and a draft reply. Customer names and contact details are removed before the text is sent to the AI provider."
              : aiConfigured === false
                ? "No AI provider is configured on this server, so triage uses transparent keyword rules (clearly labelled). You can also classify the complaint yourself below."
                : "Run triage to get a suggestion, or classify the complaint yourself below."}
          </p>
        </div>
      )}
      {latest && a && (
        <div className="space-y-4">
          <div className="flex flex-wrap items-center gap-2">
            <MachineLabel mode={latest.mode} model={latest.model} />
            <span className="text-[0.74rem] text-faint">Prompt {latest.promptVersion}</span>
          </div>
          {latest.notices.map((n) => (
            <Notice key={n} tone="watch">
              {n}
            </Notice>
          ))}
          <p className="text-[0.92rem] leading-relaxed">{a.summary}</p>
          {a.issues.length > 1 && (
            <div>
              <p className="text-[0.78rem] font-medium text-muted">Issues raised</p>
              <ul className="mt-1 list-disc pl-5 text-[0.85rem]">
                {a.issues.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          <dl className="grid grid-cols-1 gap-x-6 gap-y-3 text-[0.84rem] sm:grid-cols-2">
            <KV label="Suggested category">
              {latest.suggestion.category}
              {latest.suggestion.secondaryCategory && <span className="text-muted"> (also {latest.suggestion.secondaryCategory})</span>}
            </KV>
            <KV label="Suggested department">{latest.suggestion.department}</KV>
            <KV label="Suggested priority">
              <PriorityBadge priority={latest.suggestion.priority} confirmed={false} />
              <p className="mt-1 text-[0.76rem] text-muted">{latest.suggestion.priorityExplanation}</p>
            </KV>
            <KV label="Respond within">{a.response_within_hours} hours · urgency {a.urgency.toLowerCase()}</KV>
            <KV label="Severity and business impact">
              {a.severity}. <span className="text-muted">{a.business_impact}</span>
            </KV>
            <KV label="Customer sentiment">
              {a.sentiment}, frustration {a.frustration.toLowerCase()}
              <p className="text-[0.76rem] text-faint">Tone is shown separately from severity.</p>
            </KV>
            <KV label="Confidence">
              <Badge tone={a.confidence === "High" ? "good" : a.confidence === "Medium" ? "watch" : "risk"}>{a.confidence}</Badge>
              <p className="mt-1 text-[0.76rem] text-muted">{a.confidence_reason}</p>
              <p className="text-[0.72rem] text-faint">A qualitative judgement, not a calibrated probability.</p>
            </KV>
            <KV label="Escalation">{latest.suggestion.escalate ? <span className="text-oxide">Recommended</span> : "Not recommended"}</KV>
          </dl>
          {a.missing_information.length > 0 && (
            <div>
              <p className="text-[0.78rem] font-medium text-muted">Information still needed</p>
              <ul className="mt-1 list-disc pl-5 text-[0.85rem]">
                {a.missing_information.map((x) => (
                  <li key={x}>{x}</li>
                ))}
              </ul>
            </div>
          )}
          <div>
            <p className="text-[0.78rem] font-medium text-muted">Recommended next actions</p>
            <ol className="mt-1 list-decimal pl-5 text-[0.85rem]">
              {a.next_actions.map((x) => (
                <li key={x}>{x}</li>
              ))}
            </ol>
          </div>
          {latest.rules.hits.length > 0 && (
            <div className="rounded-md border border-line bg-paper px-3.5 py-3">
              <p className="text-[0.78rem] font-medium">Business rules that fired</p>
              <ul className="mt-1.5 space-y-1.5 text-[0.82rem]">
                {latest.rules.hits.map((h) => (
                  <li key={h.id}>
                    <Badge tone={h.escalate || h.priorityFloor === "Critical" ? "risk" : h.priorityFloor ? "watch" : "neutral"}>{h.label}</Badge> <span className="text-muted">{h.reason}</span>
                    {h.priorityFloor && <span className="text-faint"> Minimum priority {h.priorityFloor}.</span>}
                  </li>
                ))}
              </ul>
            </div>
          )}
          {(a.embedded_instructions_detected || latest.rules.hits.some((h) => h.id === "embedded_instructions")) && (
            <Notice tone="risk">The complaint text contains instructions addressed to the system. They were treated as customer text and ignored; check the classification carefully.</Notice>
          )}
          {latest.sentText && (
            <div>
              <button type="button" className="text-[0.8rem] text-glaze hover:underline" onClick={() => setShowSent((v) => !v)}>
                {showSent ? "Hide" : "Show"} what was sent for analysis
              </button>
              {showSent && (
                <div className="mt-2 rounded-md border border-line bg-paper p-3 text-[0.8rem]">
                  <p className="text-muted">
                    {latest.mode === "live" ? "Sent to the AI provider" : "Analysed locally"} after removing{" "}
                    {latest.redactions && Object.keys(latest.redactions).length ? Object.entries(latest.redactions).map(([k, v]) => `${v} ${k.replace("_", " ")}`).join(", ") : "nothing (no names or contact details found)"}
                    . Amounts, invoices and balances are not sent.
                  </p>
                  <p className="mt-2 whitespace-pre-wrap font-mono text-[0.76rem]">{latest.sentText}</p>
                </div>
              )}
            </div>
          )}
        </div>
      )}
    </Panel>
  );
}

function KV({ label, children }: { label: string; children: ReactNode }) {
  return (
    <div>
      <dt className="text-[0.76rem] text-faint">{label}</dt>
      <dd className="mt-0.5">{children}</dd>
    </div>
  );
}

function ReviewPanel({ c, latest, tax, busy, onConfirm }: { c: ComplaintCase; latest?: TriageRecord; tax: Taxonomy; busy: string | null; onConfirm: (a: CaseAction) => Promise<boolean> }) {
  const base = c.confirmed ?? (latest ? { category: latest.suggestion.category, secondaryCategory: latest.suggestion.secondaryCategory, priority: latest.suggestion.priority, department: latest.suggestion.department, owner: "" } : null);
  const [editing, setEditing] = useState(!c.confirmed);
  const [category, setCategory] = useState(base?.category ?? "");
  const [secondary, setSecondary] = useState(base?.secondaryCategory ?? "");
  const [priority, setPriority] = useState<Priority | "">(base?.priority ?? "");
  const [department, setDepartment] = useState(base?.department ?? "");
  const [owner, setOwner] = useState(c.confirmed?.owner ?? "");
  const [reason, setReason] = useState("");
  useEffect(() => {
    if (!category || department) return;
    const def = tax.categories.find((x) => x.name === category)?.department;
    if (def) setDepartment(def);
  }, [category, department, tax]);
  const floor = latest?.rules.priorityFloor ?? null;
  const belowFloor = Boolean(floor && priority && priorityRank(priority as Priority) < priorityRank(floor));
  const closed = c.status === "Closed";

  if (c.confirmed && !editing) {
    const k = c.confirmed;
    return (
      <Panel title="Human review" subtitle={`Confirmed by ${k.by} on ${when(k.at)}.`} actions={!closed ? <Button variant="ghost" onClick={() => setEditing(true)}>Change</Button> : undefined}>
        <dl className="grid grid-cols-1 gap-3 text-[0.85rem] sm:grid-cols-2">
          <KV label="Category">{k.category}{k.secondaryCategory ? ` (also ${k.secondaryCategory})` : ""}</KV>
          <KV label="Priority"><PriorityBadge priority={k.priority} /></KV>
          <KV label="Department">{k.department}</KV>
          <KV label="Owner">{k.owner || "—"}</KV>
        </dl>
        {k.agreedWithSuggestion && (
          <p className="mt-3 text-[0.78rem] text-muted">
            Compared with the suggestion: category {k.agreedWithSuggestion.category ? "kept" : "changed"}, priority {k.agreedWithSuggestion.priority ? "kept" : "changed"}, department {k.agreedWithSuggestion.department ? "kept" : "changed"}.
          </p>
        )}
        {k.overrideReason && <p className="mt-2 text-[0.8rem]"><span className="font-medium">Reason for priority below the rule minimum:</span> {k.overrideReason}</p>}
      </Panel>
    );
  }
  return (
    <Panel title="Human review" subtitle={latest ? "Check the suggestion, change anything that is wrong, then confirm. Work can only start after this step." : "Classify the complaint yourself, or run triage first for a suggestion."}>
      <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
        <Field label="Category" required>
          <select value={category} onChange={(e) => setCategory(e.target.value)} className={inputCls}>
            <option value="">Choose…</option>
            {tax.categories.map((x) => (
              <option key={x.name}>{x.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Secondary category" hint="optional">
          <select value={secondary} onChange={(e) => setSecondary(e.target.value)} className={inputCls}>
            <option value="">None</option>
            {tax.categories.filter((x) => x.name !== category).map((x) => (
              <option key={x.name}>{x.name}</option>
            ))}
          </select>
        </Field>
        <Field label="Priority" required>
          <select value={priority} onChange={(e) => setPriority(e.target.value as Priority)} className={inputCls}>
            <option value="">Choose…</option>
            {[...PRIORITIES].reverse().map((p) => (
              <option key={p}>{p}</option>
            ))}
          </select>
        </Field>
        <Field label="Department" required>
          <select value={department} onChange={(e) => setDepartment(e.target.value)} className={inputCls}>
            <option value="">Choose…</option>
            {tax.departments.map((d) => (
              <option key={d}>{d}</option>
            ))}
          </select>
        </Field>
        <div className="sm:col-span-2">
          <Field label="Responsible person" hint="optional">
            <input value={owner} onChange={(e) => setOwner(e.target.value)} className={inputCls} placeholder="Who will investigate" />
          </Field>
        </div>
        {belowFloor && (
          <div className="sm:col-span-2">
            <Field label={`Reason for setting priority below ${floor}`} required hint="business rules require at least this level">
              <textarea value={reason} onChange={(e) => setReason(e.target.value)} rows={2} className={areaCls} />
            </Field>
          </div>
        )}
      </div>
      <div className="mt-4 flex flex-wrap gap-2">
        <Button
          disabled={!category || !priority || !department || (belowFloor && !reason.trim()) || busy === "confirm_triage" || closed}
          onClick={async () => {
            const ok = await onConfirm({ type: "confirm_triage", by: "", category, secondaryCategory: secondary || null, priority: priority as Priority, department, owner, overrideReason: belowFloor ? reason : undefined } as CaseAction);
            if (ok) setEditing(false);
          }}
        >
          {busy === "confirm_triage" ? "Saving…" : "Confirm triage"}
        </Button>
        {c.confirmed && (
          <Button variant="ghost" onClick={() => setEditing(false)}>
            Cancel
          </Button>
        )}
      </div>
    </Panel>
  );
}

function EscalationPanel({ c, busy, onAck }: { c: ComplaintCase; busy: string | null; onAck: (note: string) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const e = c.escalation;
  return (
    <Panel title="Escalation to management" subtitle={e.acknowledgedBy ? `Acknowledged by ${e.acknowledgedBy} on ${when(e.acknowledgedAt!)}.` : "This case cannot be resolved until management has acknowledged it."}>
      <ul className="list-disc space-y-1 pl-5 text-[0.84rem]">
        {e.reasons.map((r) => (
          <li key={r}>{r}</li>
        ))}
      </ul>
      {e.acknowledgedBy ? (
        <p className="mt-3 text-[0.85rem]"><span className="font-medium">Decision:</span> {e.note}</p>
      ) : (
        <div className="mt-3">
          <Field label="Management decision or instruction" required>
            <textarea value={note} onChange={(ev) => setNote(ev.target.value)} rows={2} className={areaCls} placeholder="For example: Quality to visit site this week; no commitment to the customer before findings." />
          </Field>
          <div className="mt-2">
            <Button disabled={!note.trim() || busy === "acknowledge_escalation"} onClick={() => void onAck(note)}>
              Acknowledge escalation
            </Button>
          </div>
        </div>
      )}
    </Panel>
  );
}

function ResponsePanel({ c, busy, onSave, onApprove }: { c: ComplaintCase; busy: string | null; onSave: (t: string) => Promise<boolean>; onApprove: (t: string) => Promise<boolean> }) {
  const r = c.response;
  const [text, setText] = useState(r?.draft ?? "");
  const [copied, setCopied] = useState(false);
  const commitments = findCommitments(text);
  if (r?.approvedBy) {
    return (
      <Panel title="Reply to the customer" subtitle={`Approved by ${r.approvedBy} on ${when(r.approvedAt!)}. It was not sent automatically.`}>
        <p className="whitespace-pre-wrap rounded-md border border-line bg-paper p-3 text-[0.88rem] leading-relaxed">{r.approvedText}</p>
        <div className="mt-2">
          <Button
            variant="secondary"
            onClick={() => {
              void navigator.clipboard?.writeText(r.approvedText ?? "").then(() => {
                setCopied(true);
                setTimeout(() => setCopied(false), 1500);
              });
            }}
          >
            {copied ? "Copied" : "Copy reply"}
          </Button>
        </div>
      </Panel>
    );
  }
  return (
    <Panel title="Reply to the customer" subtitle="A draft only. Edit it, then approve. Approval does not send anything; you send it through your usual channel.">
      {r && r.source !== "person" && (
        <div className="mb-2">
          <MachineLabel mode={r.source === "ai" ? "live" : "rules"} />
        </div>
      )}
      <textarea value={text} onChange={(e) => setText(e.target.value)} rows={6} className={areaCls} placeholder={r ? "" : "Run triage for a draft, or write the reply yourself."} aria-label="Reply draft" />
      {commitments.length > 0 && (
        <div className="mt-2">
          <Notice tone="risk">The draft makes a commitment (&ldquo;{commitments.join("”, “")}&rdquo;). Refunds, replacements, compensation and dates need a decision by an authorised person first.</Notice>
        </div>
      )}
      <div className="mt-3 flex flex-wrap gap-2">
        <Button variant="secondary" disabled={!text.trim() || text === r?.draft || busy === "save_response_draft"} onClick={() => void onSave(text)}>
          Save draft
        </Button>
        <Button disabled={!text.trim() || !c.confirmed || busy === "approve_response"} onClick={() => void onApprove(text)}>
          Approve reply
        </Button>
        {!c.confirmed && <span className="self-center text-[0.78rem] text-faint">Confirm the triage before approving a reply.</span>}
      </div>
    </Panel>
  );
}

function StatusPanel({ c, busy, onMove, onNote }: { c: ComplaintCase; busy: string | null; onMove: (to: ComplaintCase["status"], note: string) => Promise<boolean>; onNote: (t: string) => Promise<boolean> }) {
  const [note, setNote] = useState("");
  const [comment, setComment] = useState("");
  const options = allowedTransitions(c);
  return (
    <Panel title="Status and notes" subtitle={c.resolution ? `Resolved by ${c.resolution.by} on ${when(c.resolution.at)}: ${c.resolution.note}` : "Move the case forward when the work has been done. Only people can change the status."}>
      <Field label="Note for the status change" hint="required to resolve or reopen">
        <textarea value={note} onChange={(e) => setNote(e.target.value)} rows={2} className={areaCls} placeholder="What was done or decided" />
      </Field>
      <div className="mt-3 flex flex-wrap gap-2">
        {options.map((o) => (
          <span key={o.to} title={o.reason}>
            <Button variant={o.to === "Resolved" || o.to === "Closed" ? "primary" : "secondary"} disabled={!o.allowed || busy === "transition"} onClick={() => void onMove(o.to, note).then((ok) => ok && setNote(""))}>
              {(c.status === "Resolved" || c.status === "Closed") && o.to === "Under Investigation" ? "Reopen" : `Move to ${o.to}`}
            </Button>
          </span>
        ))}
      </div>
      {options.some((o) => !o.allowed) && (
        <ul className="mt-2 text-[0.76rem] text-faint">
          {options.filter((o) => !o.allowed).map((o) => (
            <li key={o.to}>
              {o.to}: {o.reason}
            </li>
          ))}
        </ul>
      )}
      <div className="mt-5 border-t border-line pt-4">
        <Field label="Add an internal note">
          <textarea value={comment} onChange={(e) => setComment(e.target.value)} rows={2} className={areaCls} />
        </Field>
        <div className="mt-2">
          <Button variant="secondary" disabled={!comment.trim() || busy === "add_note"} onClick={() => void onNote(comment).then((ok) => ok && setComment(""))}>
            Add note
          </Button>
        </div>
      </div>
    </Panel>
  );
}

function LinkedRecordsPanel({ links, onOpen, cases }: { links: ReturnType<typeof linkedRecords>; onOpen: (id: string) => void; cases: ComplaintCase[] }) {
  const caseIds = new Set(cases.map((c) => c.id));
  const caseOf = (complaintId: string) => cases.find((c) => c.linkedComplaintId === complaintId)?.id ?? (caseIds.has(complaintId) ? complaintId : null);
  return (
    <Panel title="Linked company records" subtitle="Matched only on exact IDs. Nothing is guessed from names.">
      <div className="space-y-4 text-[0.84rem]">
        {links.customer ? (
          <section>
            <h3 className="text-[0.78rem] font-medium text-muted">Customer</h3>
            <p className="font-medium">{links.customer.customer_name}</p>
            <p className="text-muted">
              {links.customer.customer_type} · {links.customer.region} · {links.customer.channel}
              {links.customer.salesRank ? ` · number ${links.customer.salesRank} by 12-month sales` : ""}
            </p>
            <div className="mt-1.5 flex flex-wrap gap-1.5">
              {links.customer.healthBand && <Badge tone={links.customer.healthBand === "Healthy" ? "good" : links.customer.healthBand === "Watch" ? "watch" : links.customer.healthBand === "Needs attention" ? "risk" : "neutral"}>Health: {links.customer.healthBand}{links.customer.healthScore != null ? ` (${links.customer.healthScore})` : ""}</Badge>}
              {links.customer.account_status !== "Active" && <Badge tone="watch">{links.customer.account_status}</Badge>}
            </div>
            <dl className="mt-2 grid grid-cols-2 gap-1 text-[0.8rem]">
              <dt className="text-faint">Sales, last 90 days</dt>
              <dd className="text-right tabular-nums">{formatMoney(links.customer.sales90)}</dd>
              <dt className="text-faint">Change vs previous 90</dt>
              <dd className="text-right tabular-nums">{formatSignedPct(links.customer.salesTrendPct)}</dd>
              <dt className="text-faint">Overdue balance</dt>
              <dd className="text-right tabular-nums">{formatMoney(links.customer.overdue)}</dd>
            </dl>
          </section>
        ) : null}
        {links.order && (
          <section>
            <h3 className="text-[0.78rem] font-medium text-muted">Order</h3>
            <p>
              {links.order.order_id} · {formatDate(links.order.order_date)} · {links.order.status}
            </p>
            <p className="text-muted">
              {links.order.product_name} · {formatNumber(links.order.quantity)} · {formatMoney(links.order.net_sales)}
            </p>
          </section>
        )}
        {links.invoices.length > 0 && (
          <section>
            <h3 className="text-[0.78rem] font-medium text-muted">Invoice</h3>
            {links.invoices.map((i) => (
              <p key={i.invoice_id}>
                {i.invoice_id} · {formatMoney(i.amount)} · {i.outstanding > 0 ? <span className={i.daysPastDue > 0 ? "text-oxide" : ""}>{formatMoney(i.outstanding)} outstanding{i.daysPastDue > 0 ? `, ${i.daysPastDue} days past due` : ""}</span> : "paid"}
              </p>
            ))}
          </section>
        )}
        {links.sourceComplaint && (
          <section>
            <h3 className="text-[0.78rem] font-medium text-muted">Imported complaint record (source system)</h3>
            <p>
              {links.sourceComplaint.category} · {links.sourceComplaint.severity} severity · {links.sourceComplaint.assigned_team} · {links.sourceComplaint.status}
            </p>
            <p className="text-[0.76rem] text-faint">Decisions made here are shown in this app; the source system is not changed.</p>
          </section>
        )}
        {links.relatedProductComplaints.length > 0 && (
          <section>
            <h3 className="text-[0.78rem] font-medium text-muted">Same product, within 90 days ({links.relatedProductComplaints.length})</h3>
            <ul className="mt-1 space-y-0.5">
              {links.relatedProductComplaints.slice(0, 6).map((x) => (
                <RelatedRow key={x.complaint_id} x={x} caseId={caseOf(x.complaint_id)} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        )}
        {links.relatedCustomerComplaints.length > 0 && (
          <section>
            <h3 className="text-[0.78rem] font-medium text-muted">Same customer, last 12 months ({links.relatedCustomerComplaints.length})</h3>
            <ul className="mt-1 space-y-0.5">
              {links.relatedCustomerComplaints.slice(0, 6).map((x) => (
                <RelatedRow key={x.complaint_id} x={x} caseId={caseOf(x.complaint_id)} onOpen={onOpen} />
              ))}
            </ul>
          </section>
        )}
        {links.notes.map((n) => (
          <p key={n} className="text-[0.78rem] text-ochre">
            {n}
          </p>
        ))}
      </div>
    </Panel>
  );
}

function RelatedRow({ x, caseId, onOpen }: { x: Model["complaints"][number]; caseId: string | null; onOpen: (id: string) => void }) {
  return (
    <li className="text-[0.8rem]">
      {caseId ? (
        <button type="button" onClick={() => onOpen(caseId)} className="text-glaze hover:underline">
          {caseId}
        </button>
      ) : (
        <span className="text-muted">{x.complaint_id}</span>
      )}{" "}
      · {formatDate(x.date_opened)} · {x.category} · {x.status}
    </li>
  );
}
