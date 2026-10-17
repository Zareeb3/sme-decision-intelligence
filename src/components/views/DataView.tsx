"use client";

import { useState } from "react";
import { useData } from "../DataProvider";
import { Badge, Button, Notice, PageHeader, Panel } from "../ui";
import { DATASET_SPECS } from "@/lib/data/schemas";
import { DATASET_KINDS, type DatasetKind } from "@/lib/data/types";
import { REQUIRED_KINDS, type CsvTexts } from "@/lib/data/load";
import type { ValidationResult } from "@/lib/data/validate";
import { formatNumber } from "@/lib/analytics/format";

const MAX_FILE_BYTES = 15 * 1024 * 1024;

function Preview({ r }: { r: ValidationResult }) {
  const rows = (r.rows as Record<string, unknown>[]).slice(0, 5);
  if (!rows.length) return null;
  const cols = Object.keys(rows[0]);
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-line">
      <table className="w-full text-[0.72rem]">
        <thead className="bg-paper text-left text-muted">
          <tr>{cols.map((c) => <th key={c} className="whitespace-nowrap px-2 py-1.5 font-medium">{c}</th>)}</tr>
        </thead>
        <tbody>
          {rows.map((row, i) => (
            <tr key={i} className="border-t border-line/70">
              {cols.map((c) => <td key={c} className="whitespace-nowrap px-2 py-1 tabular-nums">{String(row[c] ?? "")}</td>)}
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

function ResultBlock({ kind, r }: { kind: DatasetKind; r?: ValidationResult }) {
  const spec = DATASET_SPECS[kind];
  return (
    <div className="border-b border-line py-4 first:pt-0 last:border-0 last:pb-0">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <p className="font-medium">{spec.label} <span className="font-mono text-[0.75rem] text-faint">{spec.fileName}</span></p>
          <p className="text-[0.78rem] text-muted">{spec.description}</p>
        </div>
        {!r ? (
          <Badge tone={REQUIRED_KINDS.includes(kind) ? "risk" : "neutral"}>{REQUIRED_KINDS.includes(kind) ? "Required, not loaded" : "Optional, not loaded"}</Badge>
        ) : r.ok ? (
          <Badge tone={r.rowIssues.length ? "watch" : "good"}>{formatNumber(r.validRows)} of {formatNumber(r.totalRows)} rows valid</Badge>
        ) : (
          <Badge tone="risk">Rejected</Badge>
        )}
      </div>
      {r && r.fileErrors.length > 0 && (
        <div className="mt-2"><Notice tone="risk">{r.fileErrors.join(" ")}</Notice></div>
      )}
      {r && r.warnings.length > 0 && (
        <ul className="mt-2 list-disc space-y-0.5 pl-5 text-[0.78rem] text-ochre">{r.warnings.map((w) => <li key={w}>{w}</li>)}</ul>
      )}
      {r && r.rowIssues.length > 0 && (
        <details className="mt-2">
          <summary className="text-[0.8rem] text-glaze hover:underline">Show {r.rowIssues.length + r.truncatedIssues} row issue(s)</summary>
          <table className="mt-2 w-full text-[0.75rem]">
            <thead className="text-left text-muted">
              <tr><th className="py-1 font-medium">Line</th><th className="py-1 font-medium">Column</th><th className="py-1 font-medium">Value</th><th className="py-1 font-medium">Problem</th></tr>
            </thead>
            <tbody>
              {r.rowIssues.slice(0, 50).map((iss, i) => (
                <tr key={i} className="border-t border-line/70">
                  <td className="py-1 tabular-nums">{iss.line}</td>
                  <td className="py-1 font-mono">{iss.column}</td>
                  <td className="max-w-[10rem] truncate py-1 font-mono">{iss.value || "(empty)"}</td>
                  <td className="py-1">{iss.message}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </details>
      )}
      {r?.ok && <Preview r={r} />}
    </div>
  );
}

export function DataView() {
  const { loadResult, loadSample, loadTexts, status, model } = useData();
  const [files, setFiles] = useState<Partial<Record<DatasetKind, File>>>({});
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<string | null>(null);

  function assign(list: FileList | null) {
    if (!list) return;
    const next = { ...files };
    const unmatched: string[] = [];
    for (const file of Array.from(list)) {
      const kind = DATASET_KINDS.find((k) => file.name.toLowerCase().includes(k));
      if (kind) next[kind] = file;
      else unmatched.push(file.name);
    }
    setFiles(next);
    setMessage(unmatched.length ? `Could not tell which dataset these are: ${unmatched.join(", ")}. Include orders, customers, invoices, targets or complaints in the file name, or use the per-file pickers.` : null);
  }

  async function validateAndLoad() {
    setBusy(true);
    setMessage(null);
    try {
      const texts: CsvTexts = {};
      for (const [k, f] of Object.entries(files) as [DatasetKind, File][]) {
        if (f.size > MAX_FILE_BYTES) throw new Error(`${f.name} is larger than 15 MB. Split it or filter it before uploading.`);
        texts[k] = await f.text();
      }
      const res = loadTexts(texts);
      setMessage(res.bundle ? "Uploaded data validated and loaded. All pages now use it." : `Not loaded: ${res.blockingErrors.join(" ")}`);
    } catch (e) {
      setMessage((e as Error).message);
    } finally {
      setBusy(false);
    }
  }

  const source = model?.bundle.source === "upload" ? "your uploaded files" : "the bundled synthetic sample";

  return (
    <>
      <PageHeader
        title="Data & validation"
        description="Load the synthetic sample or your own CSV exports. Files are read and validated in your browser; they are not uploaded to a server."
        actions={<Button variant="secondary" onClick={() => void loadSample()}>Reload sample data</Button>}
      />

      {status === "ready" && model && (
        <Notice tone="primary">
          Currently using {source}: {formatNumber(model.bundle.orders.length)} orders, {formatNumber(model.bundle.invoices.length)} invoices and {formatNumber(model.bundle.customers.length)} customers, from {model.minDate} to {model.maxDate}.
        </Notice>
      )}

      <div className="mt-6 grid grid-cols-1 gap-6 xl:grid-cols-[1fr_1.4fr]">
        <Panel title="Upload CSV files" subtitle="Orders, customers and invoices are required; targets and complaints are optional.">
          <label className="flex cursor-pointer flex-col items-center justify-center rounded-md border border-dashed border-line-strong bg-paper px-4 py-6 text-center hover:border-glaze">
            <span className="text-[0.9rem] font-medium">Choose several CSV files at once</span>
            <span className="mt-1 text-[0.78rem] text-muted">Matched by file name, for example orders.csv or invoices_2026.csv</span>
            <input type="file" accept=".csv,text/csv" multiple className="sr-only" onChange={(e) => assign(e.target.files)} />
          </label>
          <ul className="mt-4 space-y-2 text-[0.82rem]">
            {DATASET_KINDS.map((k) => (
              <li key={k} className="flex items-center justify-between gap-2">
                <span>{DATASET_SPECS[k].label}{REQUIRED_KINDS.includes(k) ? "" : <span className="text-faint"> (optional)</span>}</span>
                <label className="cursor-pointer truncate rounded border border-line px-2 py-1 text-[0.75rem] text-glaze hover:border-glaze">
                  {files[k]?.name ?? "Choose file"}
                  <input type="file" accept=".csv,text/csv" className="sr-only" onChange={(e) => e.target.files?.[0] && setFiles({ ...files, [k]: e.target.files[0] })} />
                </label>
              </li>
            ))}
          </ul>
          <div className="mt-4 flex items-center gap-2">
            <Button onClick={() => void validateAndLoad()} disabled={busy || Object.keys(files).length === 0}>{busy ? "Validating…" : "Validate and load"}</Button>
            {Object.keys(files).length > 0 && <Button variant="ghost" onClick={() => setFiles({})}>Clear</Button>}
          </div>
          {message && <div className="mt-3"><Notice tone={message.startsWith("Uploaded") ? "good" : "risk"}>{message}</Notice></div>}
          <p className="mt-4 text-[0.78rem] text-muted">
            Want to see validation catch problems? Download the deliberately broken{" "}
            <a className="text-glaze underline" href="/sample-data/messy/orders_with_errors.csv" download>orders file</a> or a{" "}
            <a className="text-glaze underline" href="/sample-data/messy/customers_missing_region.csv" download>customers file missing a column</a>, then upload it with the sample{" "}
            <a className="text-glaze underline" href="/sample-data/invoices.csv" download>invoices</a> and{" "}
            <a className="text-glaze underline" href="/sample-data/customers.csv" download>customers</a> files.
          </p>
        </Panel>

        <Panel title="Validation results" subtitle="Rows with problems are excluded and listed; files missing required columns are rejected.">
          {DATASET_KINDS.map((k) => <ResultBlock key={k} kind={k} r={loadResult?.results[k]} />)}
          {loadResult && loadResult.consistencyWarnings.length > 0 && (
            <div className="mt-4">
              <p className="text-[0.85rem] font-semibold">Cross-file checks</p>
              <ul className="mt-1 list-disc space-y-1 pl-5 text-[0.8rem] text-ochre">{loadResult.consistencyWarnings.map((w) => <li key={w}>{w}</li>)}</ul>
            </div>
          )}
        </Panel>
      </div>

      <Panel className="mt-6" title="Expected columns" subtitle="Full data dictionary with types and meanings: docs/DATA_DICTIONARY.md">
        <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
          {DATASET_KINDS.map((k) => (
            <div key={k}>
              <p className="font-mono text-[0.8rem] font-medium">{DATASET_SPECS[k].fileName}</p>
              <p className="mt-1 font-mono text-[0.72rem] leading-relaxed text-muted">{DATASET_SPECS[k].requiredColumns.join(", ")}</p>
            </div>
          ))}
        </div>
      </Panel>
    </>
  );
}
