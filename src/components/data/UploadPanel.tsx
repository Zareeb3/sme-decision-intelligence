"use client";

/**
 * Upload CSV exports from any system. Each file is recognised, its columns are
 * matched to the canonical fields (editable), and it is validated before
 * anything is saved. Mappings are remembered for the next upload.
 */
import { useCallback, useRef, useState } from "react";
import { useData, type SaveOutcome } from "../DataProvider";
import { Badge, Button, Notice } from "../ui";
import { parseCsv } from "@/lib/data/csv";
import { autoMap, detectKind, FIELD_SPECS, missingRequired, type ColumnMapping } from "@/lib/data/mapping";
import { validateCsv, type ValidationResult } from "@/lib/data/validate";
import { DATASET_SPECS } from "@/lib/data/schemas";
import { DATASET_KINDS, type DatasetKind } from "@/lib/data/types";
import { prefs } from "@/lib/client/browserStore";
import { REQUIRED_KINDS } from "@/lib/data/load";

const MAX_BYTES = 50 * 1024 * 1024;

interface PendingFile {
  id: number;
  name: string;
  text: string;
  headers: string[];
  firstRow: Record<string, string>;
  kind: DatasetKind | null;
  mapping: ColumnMapping;
  result: ValidationResult | null;
  open: boolean;
}

function savedOrAuto(kind: DatasetKind, headers: string[]): ColumnMapping {
  const saved = prefs.mappings()[kind];
  if (saved && saved.headers.length === headers.length && saved.headers.every((h, i) => h === headers[i])) return saved.mapping;
  return autoMap(kind, headers);
}

function MappingTable({ f, onChange }: { f: PendingFile; onChange: (field: string, col: string | null) => void }) {
  if (!f.kind) return null;
  return (
    <div className="mt-3 overflow-x-auto rounded-md border border-line">
      <table className="w-full min-w-[560px] text-[0.8rem]">
        <thead className="bg-paper text-left text-[0.72rem] text-muted">
          <tr>
            <th className="px-3 py-1.5 font-medium">Field</th>
            <th className="px-3 py-1.5 font-medium">Column in your file</th>
            <th className="px-3 py-1.5 font-medium">First value</th>
          </tr>
        </thead>
        <tbody>
          {FIELD_SPECS[f.kind].map((s) => {
            const col = f.mapping[s.field] ?? null;
            const missing = s.required && !col;
            return (
              <tr key={s.field} className="border-t border-line/70 align-top">
                <td className="px-3 py-1.5">
                  <span className="font-medium">{s.label}</span>
                  {s.required && <span className="text-oxide"> *</span>}
                  {s.help && <span className="block text-[0.72rem] text-faint">{s.help}</span>}
                </td>
                <td className="px-3 py-1.5">
                  <select
                    aria-label={`Column for ${s.label}`}
                    value={col ?? ""}
                    onChange={(e) => onChange(s.field, e.target.value || null)}
                    className={`h-8 w-full rounded border bg-surface px-2 ${missing ? "border-oxide" : "border-line-strong"}`}
                  >
                    <option value="">{s.required ? "Choose a column…" : "Not in this file"}</option>
                    {f.headers.map((h) => (
                      <option key={h} value={h}>
                        {h}
                      </option>
                    ))}
                  </select>
                </td>
                <td className="max-w-[12rem] truncate px-3 py-1.5 font-mono text-[0.72rem] text-muted">{col ? f.firstRow[col] || "(empty)" : ""}</td>
              </tr>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

function ResultSummary({ r }: { r: ValidationResult }) {
  return (
    <div className="mt-2 space-y-1.5 text-[0.8rem]">
      {r.fileErrors.length > 0 && <Notice tone="risk">{r.fileErrors.join(" ")}</Notice>}
      {r.warnings.map((w) => (
        <p key={w} className="text-ochre">{w}</p>
      ))}
      {r.notes.map((n) => (
        <p key={n} className="text-muted">{n}</p>
      ))}
      {r.rowIssues.length > 0 && (
        <details>
          <summary className="text-glaze hover:underline">Show {r.rowIssues.length + r.truncatedIssues} row issue(s)</summary>
          <ul className="mt-1 space-y-0.5 font-mono text-[0.72rem]">
            {r.rowIssues.slice(0, 30).map((i, k) => (
              <li key={k}>
                line {i.line} · {i.column} · {i.value || "(empty)"} · <span className="font-sans">{i.message}</span>
              </li>
            ))}
          </ul>
        </details>
      )}
    </div>
  );
}

export function UploadPanel({ onSaved }: { onSaved?: (o: SaveOutcome) => void }) {
  const { saveDatasets, datasets, origin, server } = useData();
  const [files, setFiles] = useState<PendingFile[]>([]);
  const [by, setBy] = useState("");
  const [busy, setBusy] = useState(false);
  const [outcome, setOutcome] = useState<SaveOutcome | null>(null);
  const [dragging, setDragging] = useState(false);
  const nextId = useRef(1);

  const validate = (f: PendingFile): PendingFile => (f.kind ? { ...f, result: validateCsv(f.kind, f.text, { mapping: f.mapping }) } : { ...f, result: null });

  const addFiles = useCallback(async (list: FileList | File[]) => {
    setOutcome(null);
    const added: PendingFile[] = [];
    for (const file of Array.from(list)) {
      if (file.size > MAX_BYTES) {
        added.push({ id: nextId.current++, name: file.name, text: "", headers: [], firstRow: {}, kind: null, mapping: {}, result: { kind: "orders", ok: false, rows: [], totalRows: 0, validRows: 0, fileErrors: ["File larger than 50 MB. Split it by period."], rowIssues: [], truncatedIssues: 0, warnings: [], notes: [], columns: [], mapping: {} }, open: false });
        continue;
      }
      const text = await file.text();
      const parsed = parseCsv(text.slice(0, 200_000));
      const kind = detectKind(file.name, parsed.headers);
      const mapping = kind ? savedOrAuto(kind, parsed.headers) : {};
      const f: PendingFile = { id: nextId.current++, name: file.name, text, headers: parsed.headers, firstRow: parsed.rows[0] ?? {}, kind, mapping, result: null, open: false };
      const v = validate(f);
      added.push({ ...v, open: !v.result?.ok });
    }
    setFiles((cur) => {
      // a new file for the same dataset replaces the older one
      const kinds = new Set(added.map((a) => a.kind).filter(Boolean));
      return [...cur.filter((c) => !kinds.has(c.kind)), ...added];
    });
  }, []);

  const update = (id: number, patch: (f: PendingFile) => PendingFile) => setFiles((cur) => cur.map((f) => (f.id === id ? validate(patch(f)) : f)));

  const companyKinds = origin === "sample" ? [] : (Object.keys(datasets) as DatasetKind[]);
  const batchKinds = files.filter((f) => f.result?.ok && f.kind).map((f) => f.kind!) as DatasetKind[];
  const missingRequired = REQUIRED_KINDS.filter((k) => !batchKinds.includes(k) && !companyKinds.includes(k));
  const hasBlocking = files.some((f) => !f.kind || !f.result?.ok);
  const canSave = batchKinds.length > 0 && missingRequired.length === 0 && !hasBlocking && !busy;

  async function save() {
    setBusy(true);
    const results: Partial<Record<DatasetKind, ValidationResult>> = {};
    const names: Partial<Record<DatasetKind, string>> = {};
    for (const f of files) {
      if (f.kind && f.result?.ok) {
        results[f.kind] = f.result;
        names[f.kind] = f.name;
        prefs.saveMapping(f.kind, f.headers, f.mapping);
      }
    }
    const o = await saveDatasets(results, names, by.trim() || "Upload screen");
    setOutcome(o);
    setBusy(false);
    if (o.ok) setFiles([]);
    onSaved?.(o);
  }

  return (
    <div>
      <label
        onDragOver={(e) => {
          e.preventDefault();
          setDragging(true);
        }}
        onDragLeave={() => setDragging(false)}
        onDrop={(e) => {
          e.preventDefault();
          setDragging(false);
          void addFiles(e.dataTransfer.files);
        }}
        className={`flex cursor-pointer flex-col items-center justify-center rounded-lg border-2 border-dashed px-4 py-8 text-center transition-colors ${dragging ? "border-glaze bg-glaze-soft" : "border-line-strong bg-paper hover:border-glaze"}`}
      >
        <span className="text-[0.95rem] font-medium">Drop CSV exports here, or choose files</span>
        <span className="mt-1 max-w-md text-[0.8rem] text-muted">
          Comma, semicolon, tab-delimited and SAP list exports are recognised. From Excel, use Save As &gt; CSV. Columns are matched automatically, including SAP field names such as VBELN, KUNNR and NETWR.
        </span>
        <input type="file" accept=".csv,.txt,.tsv,text/csv,text/plain" multiple className="sr-only" onChange={(e) => e.target.files && void addFiles(e.target.files)} />
      </label>

      {files.length > 0 && (
        <ul className="mt-4 space-y-3">
          {files.map((f) => {
            const r = f.result;
            const needsMapping = f.kind ? missingRequired_(f.kind, f.mapping) : true;
            return (
              <li key={f.id} className="rounded-lg border border-line bg-surface p-3.5">
                <div className="flex flex-wrap items-center gap-2">
                  <p className="min-w-0 flex-1 truncate font-medium">{f.name}</p>
                  <label className="sr-only" htmlFor={`kind-${f.id}`}>Dataset</label>
                  <select
                    id={`kind-${f.id}`}
                    value={f.kind ?? ""}
                    onChange={(e) => {
                      const kind = (e.target.value || null) as DatasetKind | null;
                      update(f.id, (x) => ({ ...x, kind, mapping: kind ? savedOrAuto(kind, x.headers) : {}, open: true }));
                    }}
                    className="h-8 rounded border border-line-strong bg-surface px-2 text-[0.8rem]"
                  >
                    <option value="">Which data is this?</option>
                    {DATASET_KINDS.map((k) => (
                      <option key={k} value={k}>
                        {DATASET_SPECS[k].label}
                      </option>
                    ))}
                  </select>
                  {!f.kind ? (
                    <Badge tone="watch">Choose the dataset</Badge>
                  ) : needsMapping ? (
                    <Badge tone="watch">Match the required columns</Badge>
                  ) : r?.ok ? (
                    <Badge tone={r.rowIssues.length ? "watch" : "good"}>
                      {r.validRows.toLocaleString("en-US")} of {r.totalRows.toLocaleString("en-US")} rows valid
                    </Badge>
                  ) : (
                    <Badge tone="risk">Not usable yet</Badge>
                  )}
                  <button type="button" className="text-[0.8rem] text-glaze hover:underline" onClick={() => setFiles((cur) => cur.map((x) => (x.id === f.id ? { ...x, open: !x.open } : x)))}>
                    {f.open ? "Hide columns" : "Columns"}
                  </button>
                  <button type="button" className="text-[0.8rem] text-muted hover:text-oxide" onClick={() => setFiles((cur) => cur.filter((x) => x.id !== f.id))}>
                    Remove
                  </button>
                </div>
                {f.open && <MappingTable f={f} onChange={(field, col) => update(f.id, (x) => ({ ...x, mapping: { ...x.mapping, [field]: col } }))} />}
                {r && <ResultSummary r={r} />}
              </li>
            );
          })}
        </ul>
      )}

      {files.length > 0 && (
        <div className="mt-4 flex flex-wrap items-center gap-3 border-t border-line pt-4">
          <label className="flex items-center gap-2 text-[0.82rem] text-muted">
            Uploaded by
            <input value={by} onChange={(e) => setBy(e.target.value)} placeholder="Your name" className="h-9 w-40 rounded-md border border-line-strong bg-surface px-2.5 text-ink" />
          </label>
          <Button onClick={() => void save()} disabled={!canSave}>
            {busy ? "Saving…" : `Save and load ${batchKinds.length} file${batchKinds.length === 1 ? "" : "s"}`}
          </Button>
          <span className="text-[0.78rem] text-muted">
            {missingRequired.length > 0
              ? `Still needed: ${missingRequired.map((k) => DATASET_SPECS[k].label.toLowerCase()).join(", ")}.`
              : server.storage.enabled
                ? "Saved on the server for everyone using this app."
                : "Saved in this browser only (the server has no storage)."}
          </span>
        </div>
      )}

      {outcome && (
        <div className="mt-3">
          <Notice tone={outcome.ok ? "good" : "risk"}>
            {outcome.messages.map((m) => (
              <span key={m} className="block">{m}</span>
            ))}
          </Notice>
        </div>
      )}
    </div>
  );
}

const missingRequired_ = (kind: DatasetKind, m: ColumnMapping) => missingRequired(kind, m).length > 0;
