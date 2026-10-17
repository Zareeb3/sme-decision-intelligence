"use client";

/**
 * Complaints module: triage queue, case handling and management insights.
 *
 *   Queue      what needs a decision now (register of complaint cases)
 *   Case       one complaint: original text, AI suggestion, rules, review, reply, status
 *   Insights   trends, concentrations, repeat complaints, risk customers (period filters apply)
 */
import { useCallback, useEffect, useState } from "react";
import { useData, useReadyData } from "../DataProvider";
import { Button, LoadingState, Notice, PageHeader } from "../ui";
import { ActorField, useActor, useCaseOps } from "../complaints/shared";
import { ComplaintQueue } from "../complaints/ComplaintQueue";
import { CaseDetail } from "../complaints/CaseDetail";
import { NewComplaintForm } from "../complaints/NewComplaintForm";
import { ComplaintInsightsPanel } from "../complaints/ComplaintInsightsPanel";
import type { NewCaseInput } from "@/lib/complaints/types";

type Screen = { kind: "queue" } | { kind: "insights" } | { kind: "case"; id: string } | { kind: "new"; linked: string | null };

function readScreen(): Screen {
  if (typeof window === "undefined") return { kind: "queue" };
  const p = new URLSearchParams(window.location.search);
  const id = p.get("case");
  if (id) return { kind: "case", id };
  if (p.get("view") === "insights") return { kind: "insights" };
  if (p.get("view") === "new") return { kind: "new", linked: p.get("linked") };
  return { kind: "queue" };
}

function writeScreen(s: Screen, push: boolean) {
  const p = new URLSearchParams();
  if (s.kind === "case") p.set("case", s.id);
  if (s.kind === "insights") p.set("view", "insights");
  if (s.kind === "new") {
    p.set("view", "new");
    if (s.linked) p.set("linked", s.linked);
  }
  const qs = p.toString();
  const url = `${window.location.pathname}${qs ? `?${qs}` : ""}${window.location.hash}`;
  if (push) window.history.pushState(null, "", url);
  else window.history.replaceState(null, "", url);
}

export function ComplaintsView() {
  const ready = useReadyData();
  const { origin, resetSampleCases } = useData();
  const ops = useCaseOps();
  const [actor, setActor] = useActor();
  const [screen, setScreen] = useState<Screen>({ kind: "queue" });
  const [aiConfigured, setAiConfigured] = useState<boolean | null>(null);
  const [flash, setFlash] = useState<string | null>(null);

  useEffect(() => {
    setScreen(readScreen());
    const onPop = () => setScreen(readScreen());
    window.addEventListener("popstate", onPop);
    fetch("/api/status")
      .then((r) => (r.ok ? r.json() : null))
      .then((s: { llm?: { configured: boolean } } | null) => setAiConfigured(s?.llm?.configured ?? null))
      .catch(() => setAiConfigured(null));
    return () => window.removeEventListener("popstate", onPop);
  }, []);

  const go = useCallback((s: Screen) => {
    setScreen(s);
    writeScreen(s, true);
    window.scrollTo({ top: 0 });
  }, []);

  if (!ready) return null;
  const { model, filters, settings } = ready;
  const now = ops.registerNow();

  const header = (
    <PageHeader
      title="Complaints"
      description="Every complaint as a traceable case: AI-assisted triage, business rules for high-risk cases, human decisions, and management insight."
      actions={<ActorField name={actor} setName={setActor} />}
    />
  );

  if (ops.casesState === "loading" || ops.casesState === "idle") {
    return (
      <>
        {header}
        <LoadingState label="Loading the complaint register" />
      </>
    );
  }

  async function submit(input: NewCaseInput, triageNow: boolean): Promise<string | null> {
    const r = await ops.create(input);
    if (!r.ok || !r.case) return r.message ?? "The complaint could not be saved.";
    if (triageNow) await ops.runTriage(r.case);
    setFlash(`Complaint ${r.case.id} recorded${triageNow ? " and triaged; review the suggestion" : ""}.`);
    go({ kind: "case", id: r.case.id });
    return null;
  }

  const tabs = (
    <div className="mb-5 flex flex-wrap items-center justify-between gap-3 border-b border-line">
      <div className="flex gap-1" role="tablist" aria-label="Complaints sections">
        {(
          [
            ["queue", "Triage queue"],
            ["insights", "Management insights"],
          ] as const
        ).map(([k, label]) => (
          <button
            key={k}
            type="button"
            role="tab"
            aria-selected={screen.kind === k}
            onClick={() => go({ kind: k })}
            className={`-mb-px border-b-2 px-3 py-2 text-[0.88rem] ${screen.kind === k ? "border-glaze font-medium text-glaze-deep" : "border-transparent text-muted hover:text-ink"}`}
          >
            {label}
          </button>
        ))}
      </div>
      <p className="pb-2 text-[0.76rem] text-faint">{ops.caseStore?.description}</p>
    </div>
  );

  return (
    <>
      {header}
      {ops.casesState === "error" && (
        <div className="mb-4">
          <Notice tone="risk">
            The complaint register could not be loaded: {ops.casesError}{" "}
            <button type="button" className="underline" onClick={() => void ops.refreshCases()}>
              Try again
            </button>
          </Notice>
        </div>
      )}
      {flash && screen.kind === "case" && (
        <div className="mb-4" role="status">
          <Notice tone="good">{flash}</Notice>
        </div>
      )}
      {screen.kind === "case" &&
        (() => {
          const c = ops.cases.find((x) => x.id === screen.id);
          if (!c)
            return (
              <Notice tone="watch">
                Complaint {screen.id} is not in this register.{" "}
                <button type="button" className="underline" onClick={() => go({ kind: "queue" })}>
                  Back to the queue
                </button>
              </Notice>
            );
          return (
            <CaseDetail
              c={c}
              model={model}
              baseModel={ops.baseModel ?? model}
              cases={ops.cases}
              tax={ops.tax!}
              actor={actor}
              busy={ops.busy}
              aiConfigured={aiConfigured}
              onBack={() => {
                setFlash(null);
                go({ kind: "queue" });
              }}
              onOpen={(id) => go({ kind: "case", id })}
              act={ops.act}
              runTriage={ops.runTriage}
            />
          );
        })()}
      {screen.kind === "new" && (
        <NewComplaintForm
          key={screen.linked ?? "new"}
          model={ops.baseModel ?? model}
          cases={ops.cases}
          actor={actor}
          defaultDate={origin === "sample" ? model.maxDate : new Date().toISOString().slice(0, 10)}
          linkedComplaintId={screen.linked}
          busy={Boolean(ops.busy)}
          onCancel={() => go({ kind: "queue" })}
          onSubmit={submit}
        />
      )}
      {(screen.kind === "queue" || screen.kind === "insights") && tabs}
      {screen.kind === "queue" && (
        <>
          {aiConfigured === false && (
            <div className="mb-4">
              <Notice tone="watch">No AI provider is configured, so triage suggestions come from transparent keyword rules and are labelled as such. Manual triage works as normal.</Notice>
            </div>
          )}
          <ComplaintQueue model={model} cases={ops.cases} now={now} onOpen={(id) => go({ kind: "case", id })} onNew={() => go({ kind: "new", linked: null })} onStartFromImport={(id) => go({ kind: "new", linked: id })} />
          {origin === "sample" && (
            <div className="mt-6 flex flex-wrap items-center gap-3 text-[0.8rem] text-muted">
              <span>Sample complaints are synthetic. Response targets are measured against the sample data date ({model.maxDate}).</span>
              <Button variant="ghost" onClick={() => void resetSampleCases()}>
                Reset sample complaints
              </Button>
            </div>
          )}
        </>
      )}
      {screen.kind === "insights" && <ComplaintInsightsPanel model={model} filters={filters} settings={settings} onOpenCase={(id) => go({ kind: "case", id })} />}
    </>
  );
}
