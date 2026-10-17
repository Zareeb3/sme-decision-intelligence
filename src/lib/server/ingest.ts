/**
 * Loading data into server storage, shared by the ingest API (pipelines), the
 * upload API (browser) and the drop folder.
 *
 * Every load is validated with the same rules as the browser. Nothing invalid
 * replaces good data: a file with blocking errors is rejected and the previous
 * dataset stays in place.
 */
import { timingSafeEqual } from "node:crypto";
import { toCsv } from "../data/csv";
import { DATASET_SPECS } from "../data/schemas";
import { validateCsv, type ValidationResult } from "../data/validate";
import { detectKind, type ColumnMapping } from "../data/mapping";
import { parseCsv } from "../data/csv";
import type { DatasetKind } from "../data/types";
import { DATASET_KINDS } from "../data/types";
import type { DatasetMeta, Storage } from "./storage";

export type IngestMode = "replace" | "append";

export interface IngestOutcome {
  ok: boolean;
  kind: DatasetKind;
  mode: IngestMode;
  rowsReceived: number;
  rowsValid: number;
  rowsStored: number;
  fileErrors: string[];
  warnings: string[];
  notes: string[];
  sampleIssues: ValidationResult["rowIssues"];
  meta?: DatasetMeta;
}

export function isDatasetKind(k: string): k is DatasetKind {
  return (DATASET_KINDS as string[]).includes(k);
}

/** Convert a JSON array of objects into CSV text (pipelines may post JSON). */
export function jsonToCsv(body: unknown): string {
  const rows = Array.isArray(body) ? body : Array.isArray((body as { rows?: unknown })?.rows) ? (body as { rows: unknown[] }).rows : null;
  if (!rows) throw new Error("JSON body must be an array of row objects, or { \"rows\": [...] }.");
  const objs = rows.filter((r): r is Record<string, unknown> => typeof r === "object" && r !== null);
  const headers = [...new Set(objs.flatMap((r) => Object.keys(r)))];
  return toCsv(objs as Record<string, unknown>[], headers);
}

export async function ingest(
  storage: Storage,
  kind: DatasetKind,
  text: string,
  opts: { mode?: IngestMode; source: DatasetMeta["source"]; by: string; mapping?: ColumnMapping },
): Promise<IngestOutcome> {
  const mode = opts.mode ?? "replace";
  const spec = DATASET_SPECS[kind];
  const v = validateCsv<Record<string, unknown>>(kind, text, { mapping: opts.mapping });
  const outcome: IngestOutcome = {
    ok: v.ok,
    kind,
    mode,
    rowsReceived: v.totalRows,
    rowsValid: v.validRows,
    rowsStored: 0,
    fileErrors: v.fileErrors,
    warnings: v.warnings,
    notes: v.notes,
    sampleIssues: v.rowIssues.slice(0, 20),
  };
  if (!v.ok) return outcome;

  let rows = v.rows;
  if (mode === "append") {
    const existingText = await storage.readDataset(kind);
    if (existingText) {
      const existing = validateCsv<Record<string, unknown>>(kind, existingText).rows;
      const keyOf = (r: Record<string, unknown>) => spec.key.map((k) => String(r[k])).join("|");
      const merged = new Map(existing.map((r) => [keyOf(r), r]));
      for (const r of rows) merged.set(keyOf(r), r); // incoming rows replace rows with the same key
      rows = [...merged.values()];
      outcome.notes.push(`Merged with ${existing.length} stored row(s) by ${spec.key.join(" + ")}.`);
    }
  }
  const csv = toCsv(rows, spec.allColumns);
  outcome.meta = await storage.saveDataset(kind, csv, {
    rows: rows.length,
    source: opts.source,
    by: opts.by,
    notes: [...v.warnings, ...v.notes].slice(0, 10),
  });
  outcome.rowsStored = rows.length;
  return outcome;
}

/**
 * Import every file waiting in the drop folder. The dataset is chosen from the
 * file name (e.g. "orders_2026-10-17.csv") or, failing that, from its columns.
 */
export async function importDropFolder(storage: Storage): Promise<IngestOutcome[]> {
  const results: IngestOutcome[] = [];
  for (const name of await storage.listIncoming()) {
    let text: string;
    try {
      text = await storage.readIncoming(name);
    } catch {
      continue;
    }
    const kind = detectKind(name, parseCsv(text.slice(0, 20_000)).headers);
    if (!kind) {
      await storage.archiveIncoming(name, "failed", "Could not tell which dataset this file is. Include orders, customers, invoices, payments, targets or complaints in the file name.");
      continue;
    }
    const mode: IngestMode = /append|incremental|delta/i.test(name) ? "append" : "replace";
    const r = await ingest(storage, kind, text, { mode, source: "drop-folder", by: name });
    results.push(r);
    await storage.archiveIncoming(name, r.ok ? "processed" : "failed", r.ok ? undefined : [...r.fileErrors, ...r.sampleIssues.map((i) => `line ${i.line} ${i.column}: ${i.message}`)].join("\n"));
  }
  return results;
}

/** Constant-time comparison for API tokens. */
export function tokenMatches(provided: string | null | undefined, expected: string | undefined): boolean {
  if (!provided || !expected) return false;
  const a = Buffer.from(provided);
  const b = Buffer.from(expected);
  return a.length === b.length && timingSafeEqual(a, b);
}

export function bearer(req: Request): string | null {
  const h = req.headers.get("authorization") ?? "";
  const m = /^Bearer\s+(.+)$/i.exec(h);
  return m ? m[1].trim() : req.headers.get("x-ingest-token");
}
