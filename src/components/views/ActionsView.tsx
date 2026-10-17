"use client";

import { useEffect, useMemo, useState } from "react";
import { useReadyData } from "../DataProvider";
import { Badge, Button, Notice, PageHeader, Panel } from "../ui";
import { ACTION_LABELS, ACTION_TYPES, proposeActions, type ProposedAction } from "@/lib/actions";
import { formatPKR } from "@/lib/analytics/format";

type SendState = { status: "idle" | "sending" | "sent" | "not_sent" | "rejected" | "error"; message?: string };

function ActionCard({ action }: { action: ProposedAction }) {
  const [approver, setApprover] = useState("");
  const [reviewed, setReviewed] = useState(false);
  const [state, setState] = useState<SendState>({ status: "idle" });
  const done = state.status === "sent";

  async function send() {
    setState({ status: "sending" });
    try {
      const res = await fetch("/api/actions", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action, approval: { approved: true, approverName: approver } }),
      });
      const body = (await res.json()) as { status: SendState["status"]; message: string };
      setState({ status: body.status, message: body.message });
    } catch {
      setState({ status: "error", message: "The server could not be reached. Nothing was sent." });
    }
  }

  return (
    <li className="border-b border-line py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div>
          <p className="font-medium text-ink">{action.title}</p>
          <p className="mt-0.5 text-[0.82rem] text-muted">{action.reason}</p>
          <p className="mt-1 text-[0.75rem] text-faint">Recipient: {action.recipient}</p>
        </div>
        {done && <Badge tone="good">Sent</Badge>}
      </div>
      <details className="mt-2">
        <summary className="text-[0.8rem] text-glaze hover:underline">Review payload</summary>
        <pre className="mt-2 max-h-56 overflow-auto rounded-md border border-line bg-paper p-3 font-mono text-[0.72rem] leading-relaxed text-ink">{JSON.stringify(action.payload, null, 2)}</pre>
      </details>
      {!done && (
        <div className="mt-3 flex flex-wrap items-center gap-2">
          <label className="sr-only" htmlFor={`approver-${action.id}`}>Approver name</label>
          <input
            id={`approver-${action.id}`}
            value={approver}
            onChange={(e) => setApprover(e.target.value)}
            placeholder="Approver name"
            className="h-9 w-44 rounded-md border border-line-strong bg-surface px-2.5 text-[0.82rem]"
          />
          <label className="flex items-center gap-1.5 text-[0.8rem] text-muted">
            <input type="checkbox" checked={reviewed} onChange={(e) => setReviewed(e.target.checked)} className="accent-[var(--color-glaze)]" />
            I have reviewed the payload
          </label>
          <Button onClick={() => void send()} disabled={!reviewed || approver.trim().length < 2 || state.status === "sending"}>
            {state.status === "sending" ? "Sending…" : "Approve and send"}
          </Button>
        </div>
      )}
      {state.message && (
        <div className="mt-2">
          <Notice tone={state.status === "sent" ? "good" : state.status === "not_sent" ? "watch" : "risk"}>{state.message}</Notice>
        </div>
      )}
    </li>
  );
}

export function ActionsView() {
  const ready = useReadyData();
  const [thresholdChoice, setThreshold] = useState<number | null>(null);
  const threshold = thresholdChoice ?? Math.max(1, Math.round((ready?.settings.rules.actions.overdueAlertThreshold ?? 10_000_000) / 1_000_000));
  const [n8n, setN8n] = useState<boolean | null>(null);

  useEffect(() => {
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { n8n: { configured: boolean } } | null) => setN8n(s ? s.n8n.configured : null))
      .catch(() => setN8n(null));
  }, []);

  const actions = useMemo(() => (ready ? proposeActions(ready.model, ready.filters, { overdueThresholdPkr: threshold * 1_000_000, maxPerType: 5 }) : []), [ready, threshold]);
  if (!ready) return null;

  return (
    <>
      <PageHeader
        title="Actions"
        description="Follow-ups proposed from the analytics. Nothing is sent automatically: a named person reviews the exact payload and approves each action."
      />
      <div className="mb-6 flex flex-col gap-3">
        {n8n === true && <Notice tone="good">n8n is connected. Approved actions are posted to the workflow webhook configured on the server.</Notice>}
        {n8n === false && (
          <Notice tone="watch">
            n8n is not configured, so approved actions are recorded as &quot;not sent&quot; and nothing leaves the app. Set N8N_WEBHOOK_URL on the server to connect a workflow (see docs/N8N.md).
          </Notice>
        )}
        {n8n === null && <Notice>Integration status unavailable. Approved actions will report whether they were sent.</Notice>}
        <label className="flex flex-wrap items-center gap-2 text-[0.85rem]">
          <span className="text-muted">Alert when a customer&apos;s overdue balance exceeds</span>
          <span className="inline-flex items-center rounded-md border border-line-strong bg-surface">
            <span className="pl-2.5 text-muted">{ready?.settings.currency ?? ""}</span>
            <input type="number" min={1} max={500} value={threshold} onChange={(e) => setThreshold(Math.max(1, Number(e.target.value) || 1))} className="h-9 w-20 bg-transparent px-2 text-right tabular-nums" />
            <span className="pr-2.5 text-muted">million</span>
          </span>
          <span className="text-faint">({formatPKR(threshold * 1_000_000)})</span>
        </label>
      </div>

      <div className="grid grid-cols-1 gap-6 xl:grid-cols-2">
        {ACTION_TYPES.map((t) => {
          const list = actions.filter((a) => a.type === t);
          return (
            <Panel key={t} title={ACTION_LABELS[t]} subtitle={`${list.length} proposed`}>
              {list.length ? (
                <ul>{list.map((a) => <ActionCard key={a.id} action={a} />)}</ul>
              ) : (
                <p className="text-sm text-muted">Nothing meets the rule for this action in the selected period.</p>
              )}
            </Panel>
          );
        })}
      </div>
    </>
  );
}
