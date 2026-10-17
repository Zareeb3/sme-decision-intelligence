"use client";

/**
 * Small building blocks shared by the complaint screens: badges, the person
 * acting, and the hook that performs case changes through the active store.
 */
import { useCallback, useEffect, useMemo, useState, type ReactNode } from "react";
import { useData } from "../DataProvider";
import { Badge } from "../ui";
import { taxonomyForModel } from "@/lib/complaints/context";
import { httpTransport, triageCase } from "@/lib/complaints/triage";
import { WorkflowError } from "@/lib/complaints/workflow";
import type { CaseAction, CaseStatus, ComplaintCase, NewCaseInput, Priority } from "@/lib/complaints/types";
import { referenceChecker } from "@/lib/complaints/context";

export function PriorityBadge({ priority, confirmed = true }: { priority: Priority | null | undefined; confirmed?: boolean }) {
  if (!priority) return <Badge>No priority</Badge>;
  const tone = priority === "Critical" || priority === "High" ? "risk" : priority === "Medium" ? "watch" : "neutral";
  return (
    <span title={confirmed ? "Confirmed by a person" : "Suggested, not yet confirmed"}>
      <Badge tone={tone}>
        {priority === "Critical" && <span aria-hidden>▲</span>}
        {priority}
        {!confirmed && <span className="ml-1 font-normal opacity-75">· suggested</span>}
      </Badge>
    </span>
  );
}

const STATUS_TONE: Record<CaseStatus, "neutral" | "primary" | "watch" | "good"> = {
  New: "watch",
  "AI Reviewed": "primary",
  "Under Investigation": "primary",
  "Awaiting Customer": "neutral",
  Resolved: "good",
  Closed: "neutral",
};

export function StatusBadge({ status }: { status: CaseStatus }) {
  return <Badge tone={STATUS_TONE[status]}>{status}</Badge>;
}

export function EscalatedBadge() {
  return <Badge tone="risk">Escalated</Badge>;
}

/** Marks content written by a model or by the rule-based fallback. */
export function MachineLabel({ mode, model }: { mode: "live" | "rules"; model?: string }) {
  return mode === "live" ? (
    <span className="inline-flex items-center gap-1 rounded border border-glaze/30 bg-glaze-soft px-1.5 py-0.5 text-[0.7rem] font-medium text-glaze-deep">
      <span aria-hidden>✦</span> AI-generated{model ? ` · ${model}` : ""} · needs review
    </span>
  ) : (
    <span className="inline-flex items-center gap-1 rounded border border-ochre/30 bg-ochre-soft px-1.5 py-0.5 text-[0.7rem] font-medium text-ochre">Rule-based suggestion · no AI model was called</span>
  );
}

export function Field({ label, hint, children, required }: { label: string; hint?: string; children: ReactNode; required?: boolean }) {
  return (
    <label className="block text-[0.82rem]">
      <span className="font-medium text-ink">
        {label}
        {required && <span className="text-oxide"> *</span>}
      </span>
      {hint && <span className="ml-1 text-faint">{hint}</span>}
      <div className="mt-1">{children}</div>
    </label>
  );
}

export const inputCls = "h-9 w-full rounded-md border border-line-strong bg-surface px-2.5 text-[0.88rem] focus:border-glaze";
export const areaCls = "w-full rounded-md border border-line-strong bg-surface px-2.5 py-2 text-[0.88rem] leading-relaxed focus:border-glaze";

const ACTOR_KEY = "sdi.actorName";

/** The person making changes. Required for every decision; remembered in this browser. */
export function useActor(): [string, (v: string) => void] {
  const [name, setName] = useState("");
  useEffect(() => {
    try {
      setName(localStorage.getItem(ACTOR_KEY) ?? "");
    } catch {
      /* storage blocked */
    }
  }, []);
  const set = useCallback((v: string) => {
    setName(v);
    try {
      localStorage.setItem(ACTOR_KEY, v);
    } catch {
      /* storage blocked */
    }
  }, []);
  return [name, set];
}

export function ActorField({ name, setName }: { name: string; setName: (v: string) => void }) {
  return (
    <label className="flex items-center gap-2 text-[0.82rem]">
      <span className="whitespace-nowrap text-muted">Acting as</span>
      <input value={name} onChange={(e) => setName(e.target.value)} placeholder="Your name" className={`${inputCls} h-8 w-48`} aria-label="Your name, recorded with every decision" />
    </label>
  );
}

export interface ActResult {
  ok: boolean;
  message?: string;
  case?: ComplaintCase;
}

/** Case operations through the active store (server or browser), with conflict handling. */
export function useCaseOps() {
  const { cases, caseStore, putCase, refreshCases, model, baseModel, casesState, casesError, registerNow, origin } = useData();
  const tax = useMemo(() => (baseModel ? taxonomyForModel(baseModel) : null), [baseModel]);
  const [busy, setBusy] = useState<string | null>(null);

  const act = useCallback(
    async (c: ComplaintCase, action: CaseAction): Promise<ActResult> => {
      if (!caseStore) return { ok: false, message: "The complaint register is not available." };
      setBusy(action.type);
      try {
        const updated = await caseStore.act(c.id, action, c.version);
        putCase(updated);
        return { ok: true, case: updated };
      } catch (e) {
        if (e instanceof WorkflowError && e.code === "conflict") await refreshCases();
        return { ok: false, message: (e as Error).message };
      } finally {
        setBusy(null);
      }
    },
    [caseStore, putCase, refreshCases],
  );

  const runTriage = useCallback(
    async (c: ComplaintCase): Promise<ActResult & { aiFailed?: boolean }> => {
      if (!caseStore || !model || !tax) return { ok: false, message: "Data is not loaded." };
      setBusy("triage");
      try {
        const { record, aiFailed } = await triageCase(model, c, tax, httpTransport(tax));
        let current = c;
        if (aiFailed) {
          const f = await caseStore.act(current.id, { type: "record_triage_failure", message: record.notices[0]?.slice(0, 480) ?? "AI triage failed." }, current.version);
          current = f;
        }
        const updated = await caseStore.act(current.id, { type: "record_assessment", record }, current.version);
        putCase(updated);
        return { ok: true, case: updated, aiFailed };
      } catch (e) {
        if (e instanceof WorkflowError && e.code === "conflict") await refreshCases();
        return { ok: false, message: (e as Error).message };
      } finally {
        setBusy(null);
      }
    },
    [caseStore, model, tax, putCase, refreshCases],
  );

  const create = useCallback(
    async (input: NewCaseInput): Promise<ActResult> => {
      if (!caseStore || !baseModel) return { ok: false, message: "The complaint register is not available." };
      setBusy("create");
      try {
        const created = await caseStore.create(input, referenceChecker(baseModel));
        putCase(created);
        return { ok: true, case: created };
      } catch (e) {
        return { ok: false, message: (e as Error).message };
      } finally {
        setBusy(null);
      }
    },
    [caseStore, baseModel, putCase],
  );

  return { cases, caseStore, model, baseModel, tax, act, runTriage, create, busy, casesState, casesError, refreshCases, registerNow, origin };
}
