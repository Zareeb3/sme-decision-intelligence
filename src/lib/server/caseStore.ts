/**
 * Server-side complaint register (self-hosted deployments with DATA_DIR).
 *
 * All changes go through the shared workflow functions, are serialised inside
 * this server process, and are written atomically to complaints/cases.json.
 * Reference checks (customer, order, product, invoice) use the datasets stored
 * on this server.
 *
 * Limitation: the lock is per process. Run one app instance per DATA_DIR (the
 * Docker setup does); several instances writing the same folder would need a
 * database.
 */
import { parseCsv } from "../data/csv";
import { applyAction, createCase, WorkflowError, type ReferenceCheck } from "../complaints/workflow";
import type { CaseAction, ComplaintCase, NewCaseInput } from "../complaints/types";
import type { Storage } from "./storage";

let chain: Promise<unknown> = Promise.resolve();
/** Run `fn` after every earlier register change in this process has finished. */
function serialised<T>(fn: () => Promise<T>): Promise<T> {
  const next = chain.then(fn, fn);
  chain = next.catch(() => undefined);
  return next;
}

const refCache = new WeakMap<Storage, { stamp: string; refs: ReferenceCheck }>();

async function referenceIndex(storage: Storage): Promise<ReferenceCheck | null> {
  const manifest = await storage.readManifest();
  if (!manifest.customers || !manifest.orders) return null;
  const stamp = `${manifest.customers.updatedAt}|${manifest.orders.updatedAt}|${manifest.invoices?.updatedAt ?? ""}`;
  const hit = refCache.get(storage);
  if (hit && hit.stamp === stamp) return hit.refs;
  const [cust, ord, inv] = await Promise.all([storage.readDataset("customers"), storage.readDataset("orders"), storage.readDataset("invoices")]);
  const customers = new Set((cust ? parseCsv(cust).rows : []).map((r) => r.customer_id));
  const orders = new Map((ord ? parseCsv(ord).rows : []).map((r) => [r.order_id.toLowerCase(), r]));
  const products = new Set([...orders.values()].map((r) => r.product_id));
  const invoices = new Set((inv ? parseCsv(inv).rows : []).map((r) => r.invoice_id.toLowerCase()));
  const refs: ReferenceCheck = {
    customerExists: (id) => customers.has(id),
    orderBelongsTo: (id) => {
      const o = orders.get(id.toLowerCase());
      return o ? { exists: true, customerId: o.customer_id, productId: o.product_id } : { exists: false };
    },
    productExists: (id) => products.has(id),
    invoiceExists: (id) => invoices.has(id.toLowerCase()),
  };
  refCache.set(storage, { stamp, refs });
  return refs;
}

export async function listCases(storage: Storage): Promise<ComplaintCase[]> {
  return (await storage.readCases()) as ComplaintCase[];
}

export function createCaseOnServer(storage: Storage, input: NewCaseInput): Promise<ComplaintCase> {
  return serialised(async () => {
    const cases = (await storage.readCases()) as ComplaintCase[];
    const created = createCase(input, cases, await referenceIndex(storage));
    await storage.saveCases([...cases, created]);
    return created;
  });
}

export function actOnServer(storage: Storage, id: string, action: CaseAction, expectedVersion: number | null): Promise<ComplaintCase> {
  return serialised(async () => {
    const cases = (await storage.readCases()) as ComplaintCase[];
    const i = cases.findIndex((c) => c.id === id);
    if (i < 0) throw new WorkflowError(`Case ${id} was not found.`, "not_found");
    const updated = applyAction(cases[i], action, expectedVersion);
    cases[i] = updated;
    await storage.saveCases(cases);
    return updated;
  });
}

export function workflowStatus(e: unknown): number {
  if (e instanceof WorkflowError) return e.code === "conflict" ? 409 : e.code === "forbidden" ? 403 : e.code === "not_found" ? 404 : 400;
  return 500;
}
