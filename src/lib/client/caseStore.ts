/**
 * Where the complaint register lives, seen from the browser.
 *
 * - Company data on the server  -> server register (/api/complaints/cases), shared by all users.
 * - Company data in this browser -> IndexedDB, namespace "company" (this browser only).
 * - Sample data                  -> IndexedDB, namespace "sample", seeded with synthetic cases.
 *
 * Both implementations apply the same workflow functions, so the rules are identical.
 */
import { applyAction, createCase, WorkflowError, type ReferenceCheck } from "../complaints/workflow";
import type { CaseAction, ComplaintCase, NewCaseInput } from "../complaints/types";
import { deleteBrowserCases, loadBrowserCases, saveBrowserCases } from "./browserStore";

export interface CaseStore {
  kind: "server" | "browser";
  /** False when the browser blocks storage: cases last only for this visit. */
  persistent: boolean;
  description: string;
  list(): Promise<ComplaintCase[]>;
  create(input: NewCaseInput, refs: ReferenceCheck | null): Promise<ComplaintCase>;
  act(id: string, action: CaseAction, expectedVersion: number | null): Promise<ComplaintCase>;
  /** Replace all cases (used to seed the sample register). */
  replaceAll?(cases: ComplaintCase[]): Promise<void>;
  clear?(): Promise<void>;
}

async function readError(r: Response): Promise<string> {
  const body = (await r.json().catch(() => ({}))) as { message?: string; error?: string };
  return body.message ?? body.error ?? `HTTP ${r.status}`;
}

export function serverCaseStore(): CaseStore {
  return {
    kind: "server",
    persistent: true,
    description: "Complaints are stored on the company server and shared by everyone using this app.",
    async list() {
      const r = await fetch("/api/complaints/cases", { cache: "no-store" });
      if (!r.ok) throw new Error(await readError(r));
      return ((await r.json()) as { cases: ComplaintCase[] }).cases;
    },
    async create(input) {
      const r = await fetch("/api/complaints/cases", { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(input) });
      if (!r.ok) throw new WorkflowError(await readError(r), r.status === 409 ? "conflict" : "invalid");
      return ((await r.json()) as { case: ComplaintCase }).case;
    },
    async act(id, action, expectedVersion) {
      const r = await fetch(`/api/complaints/cases/${encodeURIComponent(id)}`, { method: "PATCH", headers: { "content-type": "application/json" }, body: JSON.stringify({ action, expectedVersion }) });
      if (!r.ok) throw new WorkflowError(await readError(r), r.status === 409 ? "conflict" : r.status === 403 ? "forbidden" : r.status === 404 ? "not_found" : "invalid");
      return ((await r.json()) as { case: ComplaintCase }).case;
    },
  };
}

export async function browserCaseStore(ns: "company" | "sample"): Promise<CaseStore> {
  const loaded = await loadBrowserCases(ns);
  const persistent = loaded !== null;
  let memory = (loaded ?? []) as ComplaintCase[];
  const save = async (cases: ComplaintCase[]) => {
    memory = cases;
    if (persistent) await saveBrowserCases(ns, cases);
  };
  return {
    kind: "browser",
    persistent,
    description:
      ns === "sample"
        ? "Sample complaints (synthetic) are kept in this browser. Changes you make here do not affect anyone else."
        : persistent
          ? "This deployment has no server storage, so complaints are kept in this browser only. Use a company server to share them."
          : "This browser does not allow saving data, so complaints last only until the page is closed.",
    async list() {
      return memory;
    },
    async create(input, refs) {
      const created = createCase(input, memory, refs);
      await save([...memory, created]);
      return created;
    },
    async act(id, action, expectedVersion) {
      const i = memory.findIndex((c) => c.id === id);
      if (i < 0) throw new WorkflowError(`Case ${id} was not found.`, "not_found");
      const updated = applyAction(memory[i], action, expectedVersion);
      const next = [...memory];
      next[i] = updated;
      await save(next);
      return updated;
    },
    async replaceAll(cases) {
      await save(cases);
    },
    async clear() {
      memory = [];
      await deleteBrowserCases(ns);
    },
  };
}
