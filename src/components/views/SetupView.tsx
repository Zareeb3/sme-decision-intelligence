"use client";

import Link from "next/link";
import { useEffect, useState } from "react";
import { useData } from "../DataProvider";
import { Button, Notice, PageHeader, Panel } from "../ui";
import { CompanyForm } from "../settings/CompanyForm";
import { UploadPanel } from "../data/UploadPanel";
import { PipelinePanel } from "../data/PipelinePanel";
import { NEW_COMPANY_SETTINGS, type CompanySettings } from "@/lib/settings";
import { prefs } from "@/lib/client/browserStore";
import { formatDate, formatNumber } from "@/lib/analytics/format";
import { DATASET_SPECS } from "@/lib/data/schemas";
import type { DatasetKind } from "@/lib/data/types";

const STEPS = ["Company profile", "Connect your data", "Review"] as const;
type Source = "upload" | "pipeline" | "sample";

function Stepper({ step }: { step: number }) {
  return (
    <ol className="mb-6 flex flex-wrap gap-2" aria-label="Setup steps">
      {STEPS.map((s, i) => (
        <li
          key={s}
          aria-current={i === step ? "step" : undefined}
          className={`flex items-center gap-2 rounded-full border px-3 py-1.5 text-[0.82rem] ${i === step ? "border-glaze bg-glaze-soft font-medium text-glaze-deep" : i < step ? "border-celadon/40 text-celadon" : "border-line text-muted"}`}
        >
          <span className={`flex h-5 w-5 items-center justify-center rounded-full text-[0.7rem] ${i < step ? "bg-celadon text-white" : i === step ? "bg-glaze text-white" : "bg-paper text-muted"}`}>{i < step ? "✓" : i + 1}</span>
          {s}
        </li>
      ))}
    </ol>
  );
}

function SourceCard({ active, title, body, onClick, disabled }: { active: boolean; title: string; body: string; onClick: () => void; disabled?: boolean }) {
  return (
    <button
      type="button"
      onClick={onClick}
      disabled={disabled}
      aria-pressed={active}
      className={`rounded-lg border p-4 text-left transition-colors disabled:cursor-not-allowed disabled:opacity-50 ${active ? "border-glaze bg-glaze-soft" : "border-line bg-surface hover:border-glaze"}`}
    >
      <p className="font-semibold">{title}</p>
      <p className="mt-1 text-[0.82rem] leading-relaxed text-muted">{body}</p>
    </button>
  );
}

export function SetupView() {
  const { settings, origin, saveSettings, server, loadSample, status, model, loadResult } = useData();
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<CompanySettings>(origin === "sample" || !origin ? NEW_COMPANY_SETTINGS : settings);
  const [source, setSource] = useState<Source>("upload");
  const [saved, setSaved] = useState<string | null>(null);

  useEffect(() => {
    if (origin === "server" || origin === "browser") setDraft(settings);
  }, [origin, settings]);

  const company = origin === "server" || origin === "browser";

  return (
    <>
      <PageHeader title="Set up your company" description="Three steps: describe the business, connect its data, check what was loaded. Everything can be changed later in Settings and Data sources." />
      <Stepper step={step} />

      {step === 0 && (
        <Panel title="Company profile" subtitle="Used for labels, currency, fiscal periods and the AI analyst's context.">
          <CompanyForm value={draft} onChange={setDraft} />
          <div className="mt-5 flex items-center gap-3">
            <Button
              onClick={async () => {
                setSaved(await saveSettings(draft));
                setStep(1);
              }}
              disabled={!draft.companyName.trim()}
            >
              Save and continue
            </Button>
            {saved && <span className="text-[0.8rem] text-muted">{saved}</span>}
          </div>
        </Panel>
      )}

      {step === 1 && (
        <>
          <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
            <SourceCard active={source === "upload"} title="Upload files" body="CSV exports from SAP, another ERP or Excel. Columns are matched for you and checked before loading. Best for a first look or a monthly routine." onClick={() => setSource("upload")} />
            <SourceCard
              active={source === "pipeline"}
              title="Connect a pipeline"
              body="Automatic nightly loads from SAP or any ETL tool through a secure API or a shared drop folder. Best for day-to-day use."
              onClick={() => setSource("pipeline")}
            />
            <SourceCard
              active={source === "sample"}
              title="Explore sample data"
              body="A fictional tile manufacturer with three years of history. Useful for training and demonstrations; your settings are kept for later."
              onClick={() => setSource("sample")}
              disabled={!server.sampleEnabled}
            />
          </div>

          <Panel className="mt-5" title={source === "upload" ? "Upload your exports" : source === "pipeline" ? "Connect a data pipeline" : "Sample data"}>
            {source === "upload" && (
              <>
                <p className="mb-4 text-[0.85rem] text-muted">
                  You need three files to start: <strong className="font-medium text-ink">sales lines</strong>, <strong className="font-medium text-ink">customers</strong> and{" "}
                  <strong className="font-medium text-ink">invoices</strong>. Payments, targets and complaints are optional and unlock more analysis. Templates are on the Data sources page.
                </p>
                <UploadPanel onSaved={(o) => o.ok && setStep(2)} />
              </>
            )}
            {source === "pipeline" && (
              <>
                <PipelinePanel />
                <div className="mt-5 border-t border-line pt-4">
                  <Button onClick={() => setStep(2)} disabled={!company}>
                    {company ? "Data received. Continue" : "Waiting for the first load"}
                  </Button>
                </div>
              </>
            )}
            {source === "sample" && (
              <div>
                <p className="text-[0.85rem] text-muted">Load the fictional sample to explore every screen. When your own data arrives, it replaces the sample automatically.</p>
                <div className="mt-4">
                  <Button
                    onClick={async () => {
                      await loadSample();
                      setStep(2);
                    }}
                  >
                    Load sample data
                  </Button>
                </div>
              </div>
            )}
          </Panel>
          <button type="button" className="mt-4 text-[0.85rem] text-glaze hover:underline" onClick={() => setStep(0)}>
            Back to company profile
          </button>
        </>
      )}

      {step === 2 && (
        <Panel title="Review" subtitle="What was loaded and anything to check before sharing results.">
          {status === "loading" && <p className="text-sm text-muted">Loading…</p>}
          {status === "ready" && model && (
            <>
              <dl className="grid grid-cols-2 gap-4 sm:grid-cols-4">
                {(["orders", "customers", "invoices", "payments", "targets", "complaints"] as DatasetKind[]).map((k) => (
                  <div key={k}>
                    <dt className="text-[0.78rem] text-muted">{DATASET_SPECS[k].label}</dt>
                    <dd className="text-[1.2rem] font-semibold tabular-nums">{formatNumber((model.bundle[k] as unknown[]).length)}</dd>
                  </div>
                ))}
              </dl>
              <p className="mt-4 text-[0.85rem]">
                Data covers <strong className="font-medium">{formatDate(model.minDate)}</strong> to <strong className="font-medium">{formatDate(model.maxDate)}</strong>
                {origin === "sample" ? " (sample data)." : "."}
              </p>
              {loadResult && loadResult.consistencyWarnings.length > 0 && (
                <div className="mt-3">
                  <Notice tone="watch">
                    {loadResult.consistencyWarnings.map((w) => (
                      <span key={w} className="block">{w}</span>
                    ))}
                  </Notice>
                </div>
              )}
              <div className="mt-5 flex flex-wrap gap-3">
                <Link href="/" onClick={() => prefs.setSetupDone(true)} className="rounded-md bg-glaze px-4 py-2 text-sm font-medium text-white hover:bg-glaze-deep">
                  Open the overview
                </Link>
                <Link href="/data" className="rounded-md border border-line-strong px-4 py-2 text-sm hover:border-glaze">
                  Data sources
                </Link>
                <Link href="/settings" className="rounded-md border border-line-strong px-4 py-2 text-sm hover:border-glaze">
                  Adjust business rules
                </Link>
              </div>
            </>
          )}
          {status !== "ready" && status !== "loading" && <p className="text-sm text-muted">No data is loaded yet. Go back and upload files or connect a pipeline.</p>}
        </Panel>
      )}
    </>
  );
}
