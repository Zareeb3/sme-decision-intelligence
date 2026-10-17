/**
 * CSV validation pipeline (shared by sample data, uploads and pipeline ingest).
 *
 *   text -> parseCsv (auto delimiter) -> column mapping -> normalise values
 *        -> defaults -> per-row Zod validation -> duplicate-key check
 *
 * Policy: a file missing a required field is rejected outright. Individual
 * invalid rows are excluded and reported, so one bad row does not block a
 * whole upload, but the user always sees how many rows were dropped and why.
 */
import { parseCsv } from "./csv";
import { DATASET_SPECS } from "./schemas";
import { autoMap, FIELD_SPECS, missingRequired, toCanonicalRows, type ColumnMapping } from "./mapping";
import type { DataBundle, DatasetKind } from "./types";

export interface RowIssue {
  /** Line number in the source file (header is line 1). */
  line: number;
  column: string;
  value: string;
  message: string;
}

export interface ValidationResult<T = unknown> {
  kind: DatasetKind;
  ok: boolean;
  rows: T[];
  totalRows: number;
  validRows: number;
  /** Blocking problems with the file as a whole. */
  fileErrors: string[];
  rowIssues: RowIssue[];
  /** Number of row issues not listed because of the display cap. */
  truncatedIssues: number;
  warnings: string[];
  /** Notes about formats detected and defaults applied. */
  notes: string[];
  /** Source file headers. */
  columns: string[];
  /** Canonical field -> source column used. */
  mapping: ColumnMapping;
}

const MAX_ISSUES = 200;

export interface ValidateOptions {
  /** Explicit mapping; when omitted, columns are matched automatically. */
  mapping?: ColumnMapping;
}

export function validateCsv<T = unknown>(kind: DatasetKind, text: string, opts: ValidateOptions = {}): ValidationResult<T> {
  const spec = DATASET_SPECS[kind];
  const result: ValidationResult<T> = {
    kind,
    ok: false,
    rows: [],
    totalRows: 0,
    validRows: 0,
    fileErrors: [],
    rowIssues: [],
    truncatedIssues: 0,
    warnings: [],
    notes: [],
    columns: [],
    mapping: {},
  };

  if (!text || text.trim() === "") {
    result.fileErrors.push(`${spec.fileName} is empty.`);
    return result;
  }

  const parsed = parseCsv(text);
  result.columns = parsed.headers;
  result.totalRows = parsed.rows.length + parsed.malformedLines.length;
  const mapping = opts.mapping ?? autoMap(kind, parsed.headers);
  result.mapping = mapping;

  const missing = missingRequired(kind, mapping);
  if (missing.length > 0) {
    const labels = missing.map((m) => FIELD_SPECS[kind].find((s) => s.field === m)?.label ?? m);
    result.fileErrors.push(
      `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")} (${labels.join(", ")}). ` +
        `Expected columns: ${spec.requiredColumns.join(", ")}. Map them in the upload screen or rename the columns.`,
    );
    return result;
  }
  if (result.totalRows === 0) {
    result.fileErrors.push(`${spec.fileName} has a header row but no data rows.`);
    return result;
  }

  const usedColumns = new Set(Object.values(mapping).filter(Boolean) as string[]);
  const extra = parsed.headers.filter((c) => !usedColumns.has(c));
  if (extra.length > 0) {
    result.notes.push(extra.length <= 6 ? `Ignored column(s) not needed: ${extra.join(", ")}.` : `Ignored ${extra.length} columns that are not needed.`);
  }
  if (parsed.malformedLines.length > 0) {
    result.warnings.push(
      `${parsed.malformedLines.length} line(s) had the wrong number of fields and were skipped (first: line ${parsed.malformedLines[0]}).`,
    );
  }

  const canonical = toCanonicalRows(kind, parsed.rows, mapping);
  result.notes.push(...canonical.notes);

  const addIssue = (issue: RowIssue) => {
    if (result.rowIssues.length < MAX_ISSUES) result.rowIssues.push(issue);
    else result.truncatedIssues++;
  };

  const seenKeys = new Map<string, number>();
  canonical.rows.forEach((row, i) => {
    const line = i + 2;
    const res = spec.schema.safeParse(row);
    if (!res.success) {
      for (const iss of res.error.issues) {
        const column = String(iss.path[0] ?? "");
        const src = mapping[column];
        addIssue({ line, column: src && src !== column ? `${column} (${src})` : column, value: src ? (parsed.rows[i][src] ?? "") : row[column] ?? "", message: iss.message });
      }
      return;
    }
    const key = spec.key.map((k) => row[k]).join("|");
    const firstLine = seenKeys.get(key);
    if (firstLine !== undefined) {
      addIssue({
        line,
        column: spec.key.join("+"),
        value: key,
        message: `Duplicate ${spec.key.join(" + ")} (first seen on line ${firstLine}); duplicate row excluded`,
      });
      return;
    }
    seenKeys.set(key, line);
    result.rows.push(res.data as T);
  });

  result.validRows = result.rows.length;
  const excluded = result.totalRows - result.validRows;
  if (excluded > 0) result.warnings.push(`${excluded} of ${result.totalRows} row(s) were excluded because of the issues listed.`);
  if (result.validRows === 0) result.fileErrors.push("No valid rows remain after validation.");
  result.ok = result.fileErrors.length === 0;
  return result;
}

/**
 * Cross-file consistency checks. These never drop data; they produce warnings
 * so that a manager knows which joins may be incomplete.
 */
export function checkBundleConsistency(bundle: DataBundle): string[] {
  const warnings: string[] = [];
  const customerIds = new Set(bundle.customers.map((c) => c.customer_id));
  const orderIds = new Set(bundle.orders.map((o) => o.order_id));
  const invoiceIds = new Set(bundle.invoices.map((i) => i.invoice_id));

  const unknownOrderCustomers = bundle.orders.filter((o) => !customerIds.has(o.customer_id));
  if (unknownOrderCustomers.length > 0) {
    const sample = [...new Set(unknownOrderCustomers.map((o) => o.customer_id))].slice(0, 5).join(", ");
    warnings.push(
      `${unknownOrderCustomers.length} sales line(s) reference customer IDs not found in the customer file (e.g. ${sample}). ` +
        "Their sales are counted, but customer-level analysis will be incomplete.",
    );
  }
  const unknownInvoiceCustomers = bundle.invoices.filter((i) => !customerIds.has(i.customer_id));
  if (unknownInvoiceCustomers.length > 0) {
    warnings.push(`${unknownInvoiceCustomers.length} invoice(s) reference customer IDs not found in the customer file; they appear under region "Unassigned".`);
  }
  const unlinkedInvoices = bundle.invoices.filter((inv) => inv.order_id && !orderIds.has(inv.order_id));
  if (unlinkedInvoices.length > 0) {
    warnings.push(
      `${unlinkedInvoices.length} invoice(s) reference order IDs not found in the sales file. ` +
        "They are included in receivables using the customer's region and channel, but are excluded when a product filter is applied.",
    );
  }
  if (bundle.payments.length > 0) {
    const orphan = bundle.payments.filter((p) => !invoiceIds.has(p.invoice_id));
    if (orphan.length > 0) {
      warnings.push(`${orphan.length} payment(s) reference invoice IDs not found in the invoice file and are not counted.`);
    }
    if (bundle.invoices.some((i) => i.amount_paid_pkr > 0)) {
      warnings.push("A payments file is loaded, so paid amounts and dates on the invoice file are ignored in favour of the individual payments.");
    }
  } else {
    const overpaid = bundle.invoices.filter((inv) => inv.amount_paid_pkr > inv.invoice_amount_pkr + 1);
    if (overpaid.length > 0) {
      warnings.push(`${overpaid.length} invoice(s) show payments above the invoice amount; outstanding is floored at zero.`);
    }
  }
  if (bundle.targets.length === 0) warnings.push("No targets loaded: target attainment metrics are unavailable.");
  if (bundle.complaints.length === 0) warnings.push("No complaints loaded: complaint metrics show zero.");
  return warnings;
}
