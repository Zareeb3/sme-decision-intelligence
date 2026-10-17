"use client";

import Link from "next/link";
import { useState } from "react";
import { useData } from "../DataProvider";
import { Button, Notice, PageHeader, Panel } from "../ui";
import { UploadPanel } from "../data/UploadPanel";
import { PipelinePanel } from "../data/PipelinePanel";
import { DatasetTable } from "../data/DatasetTable";
import { DATASET_SPECS } from "@/lib/data/schemas";
import { DATASET_KINDS } from "@/lib/data/types";
import { FIELD_SPECS } from "@/lib/data/mapping";
import { formatDate } from "@/lib/analytics/format";

type Tab = "upload" | "pipeline" | "columns";

export function DataView() {
  const { origin, model, loadResult, server, hideSample, setHideSample, loadSample, removeCompanyData, status } = useData();
  const [tab, setTab] = useState<Tab>("upload");
  const company = origin === "server" || origin === "browser";

  return (
    <>
      <PageHeader
        title="Data sources"
        description="Where the numbers come from, how fresh they are, and how to load more. Every file is validated before it replaces anything."
        actions={
          <Link href="/setup" className="rounded-md border border-line-strong px-3.5 py-2 text-sm hover:border-glaze">
            Run setup again
          </Link>
        }
      />

      <div className="mb-6">
        {status === "ready" && model && (
          <Notice tone={company ? "good" : "watch"}>
            {company ? (
              <>Using company data {origin === "server" ? "stored on the server" : "stored in this browser"}, covering {formatDate(model.minDate)} to {formatDate(model.maxDate)}.</>
            ) : (
              <>Showing the fictional sample data. Upload your exports or connect a pipeline below; your data replaces the sample automatically.</>
            )}
          </Notice>
        )}
        {status === "empty" && <Notice tone="watch">No data is loaded yet. Upload files or connect a pipeline below.</Notice>}
      </div>

      <Panel title="Datasets" subtitle="Status of each dataset, with downloads, CSV templates and version restore.">
        <DatasetTable />
        {loadResult && loadResult.consistencyWarnings.length > 0 && (
          <div className="mt-4">
            <p className="text-[0.82rem] font-semibold">Cross-file checks</p>
            <ul className="mt-1 list-disc space-y-1 pl-5 text-[0.8rem] text-ochre">
              {loadResult.consistencyWarnings.map((w) => (
                <li key={w}>{w}</li>
              ))}
            </ul>
          </div>
        )}
      </Panel>

      <div className="mt-6">
        <div role="tablist" aria-label="Ways to load data" className="flex flex-wrap gap-1 border-b border-line">
          {(
            [
              ["upload", "Upload files"],
              ["pipeline", "Automated pipeline"],
              ["columns", "Expected columns"],
            ] as [Tab, string][]
          ).map(([id, label]) => (
            <button
              key={id}
              role="tab"
              type="button"
              aria-selected={tab === id}
              onClick={() => setTab(id)}
              className={`-mb-px border-b-2 px-4 py-2 text-[0.88rem] ${tab === id ? "border-glaze font-medium text-glaze-deep" : "border-transparent text-muted hover:text-ink"}`}
            >
              {label}
            </button>
          ))}
        </div>
        <div className="rounded-b-lg border border-t-0 border-line bg-surface p-5">
          {tab === "upload" && <UploadPanel />}
          {tab === "pipeline" && <PipelinePanel />}
          {tab === "columns" && (
            <div className="grid gap-5 md:grid-cols-2">
              {DATASET_KINDS.map((k) => (
                <div key={k}>
                  <p className="font-medium">
                    {DATASET_SPECS[k].label} <span className="font-mono text-[0.75rem] text-faint">{DATASET_SPECS[k].fileName}</span>
                  </p>
                  <p className="text-[0.78rem] text-muted">{DATASET_SPECS[k].description}</p>
                  <ul className="mt-2 space-y-0.5 text-[0.78rem]">
                    {FIELD_SPECS[k].map((s) => (
                      <li key={s.field}>
                        <span className="font-mono">{s.field}</span>
                        {s.required && <span className="text-oxide"> *</span>} <span className="text-muted">{s.label}</span>
                      </li>
                    ))}
                  </ul>
                </div>
              ))}
              <p className="text-[0.78rem] text-faint md:col-span-2">* required. Full definitions: docs/DATA_DICTIONARY.md. SAP field mapping: docs/SAP_INTEGRATION.md.</p>
            </div>
          )}
        </div>
      </div>

      <Panel className="mt-6" title="Sample data and removal">
        <div className="flex flex-wrap items-center gap-3">
          {server.sampleEnabled ? (
            <label className="flex items-center gap-2 text-[0.85rem]">
              <input type="checkbox" className="accent-[var(--color-glaze)]" checked={!hideSample} onChange={(e) => void setHideSample(!e.target.checked)} />
              Show the sample data when no company data is loaded (this browser)
            </label>
          ) : (
            <span className="text-[0.85rem] text-muted">Sample data is switched off on this server (ENABLE_SAMPLE_DATA=false).</span>
          )}
          {origin !== "sample" && server.sampleEnabled && !company && (
            <Button variant="secondary" onClick={() => void loadSample()}>
              Load sample data
            </Button>
          )}
          {company && (
            <Button
              variant="secondary"
              onClick={async () => {
                if (window.confirm(`Remove all company data from ${origin === "server" ? "the server" : "this browser"}? This cannot be undone.`)) await removeCompanyData();
              }}
            >
              Remove all company data
            </Button>
          )}
        </div>
      </Panel>
    </>
  );
}
