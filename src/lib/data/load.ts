/**
 * Turning CSV text into a validated DataBundle. Works in the browser (sample
 * data fetched from /sample-data) and in Node (tests read the same files).
 */
import { checkBundleConsistency, validateCsv, type ValidationResult } from "./validate";
import type { Complaint, Customer, DataBundle, DatasetKind, Invoice, Order, Target } from "./types";
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

/** Orders and invoices are essential; the other files are optional but recommended. */
export const REQUIRED_KINDS: DatasetKind[] = ["orders", "invoices", "customers"];

export function buildBundle(texts: CsvTexts, source: DataBundle["source"]): LoadResult {
  const results: LoadResult["results"] = {};
  const blockingErrors: string[] = [];
  for (const kind of DATASET_KINDS) {
    const text = texts[kind];
    if (text === undefined) {
      if (REQUIRED_KINDS.includes(kind)) blockingErrors.push(`${DATASET_SPECS[kind].fileName} is required.`);
      continue;
    }
    const r = validateCsv(kind, text);
    results[kind] = r;
    if (!r.ok && REQUIRED_KINDS.includes(kind)) {
      blockingErrors.push(`${DATASET_SPECS[kind].fileName}: ${r.fileErrors.join(" ")}`);
    }
  }
  if (blockingErrors.length > 0) return { bundle: null, results, consistencyWarnings: [], blockingErrors };

  const rowsOf = <T>(k: DatasetKind) => (results[k]?.ok ? (results[k]!.rows as T[]) : []);
  const bundle: DataBundle = {
    orders: rowsOf<Order>("orders"),
    customers: rowsOf<Customer>("customers"),
    invoices: rowsOf<Invoice>("invoices"),
    targets: rowsOf<Target>("targets"),
    complaints: rowsOf<Complaint>("complaints"),
    source,
  };
  return { bundle, results, consistencyWarnings: checkBundleConsistency(bundle), blockingErrors };
}

/** Browser: fetch the bundled synthetic sample data. */
export async function fetchSampleTexts(basePath = "/sample-data"): Promise<CsvTexts> {
  const entries = await Promise.all(
    DATASET_KINDS.map(async (k) => {
      const res = await fetch(`${basePath}/${DATASET_SPECS[k].fileName}`);
      if (!res.ok) throw new Error(`Could not load ${DATASET_SPECS[k].fileName} (HTTP ${res.status}).`);
      return [k, await res.text()] as const;
    }),
  );
  return Object.fromEntries(entries);
}
