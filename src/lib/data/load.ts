/**
 * Turning CSV text into a validated DataBundle. Works in the browser (sample
 * data, uploads, data fetched from the server) and in Node (tests, ingest API).
 */
import { checkBundleConsistency, validateCsv, type ValidationResult } from "./validate";
import type { ColumnMapping } from "./mapping";
import { addDays } from "../analytics/dates";
import type { Complaint, Customer, DataBundle, DatasetKind, Invoice, Order, Payment, Target } from "./types";
import { DATASET_KINDS } from "./types";
import { DATASET_SPECS } from "./schemas";

export type CsvTexts = Partial<Record<DatasetKind, string>>;

export interface LoadResult {
  bundle: DataBundle | null;
  results: Partial<Record<DatasetKind, ValidationResult>>;
  /** Cross-file warnings (unknown IDs, missing targets, ...). */
  consistencyWarnings: string[];
  /** Blocking reasons why the bundle could not be built. */
  blockingErrors: string[];
}

/** Sales, customers and invoices are essential; the other files are optional. */
export const REQUIRED_KINDS: DatasetKind[] = DATASET_KINDS.filter((k) => !DATASET_SPECS[k].optional);

export function buildBundle(
  texts: CsvTexts,
  source: DataBundle["source"],
  opts: { mappings?: Partial<Record<DatasetKind, ColumnMapping>> } = {},
): LoadResult {
  const results: LoadResult["results"] = {};
  const blockingErrors: string[] = [];
  for (const kind of DATASET_KINDS) {
    const text = texts[kind];
    if (text === undefined || text === null) {
      if (REQUIRED_KINDS.includes(kind)) blockingErrors.push(`${DATASET_SPECS[kind].label} (${DATASET_SPECS[kind].fileName}) is required.`);
      continue;
    }
    const r = validateCsv(kind, text, { mapping: opts.mappings?.[kind] });
    results[kind] = r;
    if (!r.ok && REQUIRED_KINDS.includes(kind)) {
      blockingErrors.push(`${DATASET_SPECS[kind].label}: ${r.fileErrors.join(" ")}`);
    }
  }
  if (blockingErrors.length > 0) return { bundle: null, results, consistencyWarnings: [], blockingErrors };

  const rowsOf = <T>(k: DatasetKind) => (results[k]?.ok ? (results[k]!.rows as T[]) : []);
  const bundle: DataBundle = {
    orders: rowsOf<Order>("orders"),
    customers: rowsOf<Customer>("customers"),
    invoices: rowsOf<Invoice>("invoices"),
    payments: rowsOf<Payment>("payments"),
    targets: rowsOf<Target>("targets"),
    complaints: rowsOf<Complaint>("complaints"),
    source,
  };
  completeFromCustomers(bundle);
  return { bundle, results, consistencyWarnings: checkBundleConsistency(bundle), blockingErrors };
}

/** Fill fields that depend on the customer master (region/channel on sales lines, due dates). */
function completeFromCustomers(bundle: DataBundle) {
  const customers = new Map(bundle.customers.map((c) => [c.customer_id, c]));
  for (const o of bundle.orders) {
    const c = customers.get(o.customer_id);
    if (!o.region) o.region = c?.region ?? "Unassigned";
    if (!o.channel) o.channel = c?.channel ?? "Unassigned";
  }
  for (const inv of bundle.invoices) {
    if (!inv.due_date) inv.due_date = addDays(inv.invoice_date, customers.get(inv.customer_id)?.payment_terms_days ?? 30);
  }
}

/** Sample files shipped with the app. Payments are not part of the sample (invoices carry the payment). */
export const SAMPLE_KINDS: DatasetKind[] = ["orders", "customers", "invoices", "targets", "complaints"];

/** Browser: fetch the bundled synthetic sample data. */
export async function fetchSampleTexts(basePath = "/sample-data"): Promise<CsvTexts> {
  const entries = await Promise.all(
    SAMPLE_KINDS.map(async (k) => {
      const res = await fetch(`${basePath}/${DATASET_SPECS[k].fileName}`);
      if (!res.ok) throw new Error(`Could not load ${DATASET_SPECS[k].fileName} (HTTP ${res.status}).`);
      return [k, await res.text()] as const;
    }),
  );
  return Object.fromEntries(entries);
}
