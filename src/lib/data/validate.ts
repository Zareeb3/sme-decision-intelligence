/**
 * CSV validation pipeline.
 *
 *   text -> parseCsv -> column check -> per-row Zod parse -> duplicate check
 *
 * Policy: a file with missing required columns is rejected outright.
 * Individual invalid rows are excluded and reported, so one bad row does not
 * block the whole upload, but the user always sees how many rows were dropped.
 */
import { parseCsv } from "./csv";
import { DATASET_SPECS } from "./schemas";
import type { DataBundle, DatasetKind } from "./types";

export interface RowIssue {
  /** Line number in the CSV file (header is line 1). */
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
  columns: string[];
}

const MAX_ISSUES = 200;

export function validateCsv<T = unknown>(kind: DatasetKind, text: string): ValidationResult<T> {
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
    columns: [],
  };

  if (!text || text.trim() === "") {
    result.fileErrors.push(`${spec.fileName} is empty.`);
    return result;
  }

  const parsed = parseCsv(text);
  result.columns = parsed.headers;
  result.totalRows = parsed.rows.length + parsed.malformedLines.length;

  const missing = spec.requiredColumns.filter((c) => !parsed.headers.includes(c));
  if (missing.length > 0) {
    result.fileErrors.push(
      `Missing required column${missing.length > 1 ? "s" : ""}: ${missing.join(", ")}. ` +
        `Expected columns: ${spec.requiredColumns.join(", ")}.`,
    );
    return result;
  }
  if (result.totalRows === 0) {
    result.fileErrors.push(`${spec.fileName} has a header row but no data rows.`);
    return result;
  }

  const extra = parsed.headers.filter((c) => !spec.requiredColumns.includes(c));
  if (extra.length > 0) result.warnings.push(`Ignored extra column(s): ${extra.join(", ")}.`);
  if (parsed.malformedLines.length > 0) {
    result.warnings.push(
      `${parsed.malformedLines.length} line(s) had the wrong number of fields and were skipped (first: line ${parsed.malformedLines[0]}).`,
    );
  }

  const addIssue = (issue: RowIssue) => {
    if (result.rowIssues.length < MAX_ISSUES) result.rowIssues.push(issue);
    else result.truncatedIssues++;
  };

  const seenKeys = new Map<string, number>();
  parsed.rows.forEach((raw, i) => {
    const line = i + 2;
    const res = spec.schema.safeParse(raw);
    if (!res.success) {
      for (const iss of res.error.issues) {
        const column = String(iss.path[0] ?? "");
        addIssue({ line, column, value: raw[column] ?? "", message: iss.message });
      }
      return;
    }
    const key = spec.key.map((k) => raw[k]).join("|");
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

  const unknownOrderCustomers = bundle.orders.filter((o) => !customerIds.has(o.customer_id));
  if (unknownOrderCustomers.length > 0) {
    const sample = [...new Set(unknownOrderCustomers.map((o) => o.customer_id))].slice(0, 5).join(", ");
    warnings.push(
      `${unknownOrderCustomers.length} order(s) reference customer IDs not found in customers.csv (e.g. ${sample}). ` +
        "Their sales are counted, but customer-level analysis will be incomplete.",
    );
  }
  const unlinkedInvoices = bundle.invoices.filter((inv) => !orderIds.has(inv.order_id));
  if (unlinkedInvoices.length > 0) {
    warnings.push(
      `${unlinkedInvoices.length} invoice(s) reference order IDs not found in orders.csv. ` +
        "They are included in receivables using the customer's region and channel, but are excluded when a product filter is applied.",
    );
  }
  const overpaid = bundle.invoices.filter((inv) => inv.amount_paid_pkr > inv.invoice_amount_pkr + 1);
  if (overpaid.length > 0) {
    warnings.push(`${overpaid.length} invoice(s) show payments above the invoice amount; outstanding is floored at zero.`);
  }
  if (bundle.targets.length === 0) warnings.push("No targets loaded: target attainment metrics are unavailable.");
  if (bundle.complaints.length === 0) warnings.push("No complaints loaded: complaint metrics show zero.");
  return warnings;
}
