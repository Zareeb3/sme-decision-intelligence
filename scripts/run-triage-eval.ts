/**
 * Evaluate complaint triage on the hand-labelled set and write a report.
 *
 *   npm run eval:triage        rule-based fallback (no API key needed, deterministic)
 *   npm run eval:triage:live   live model + business rules (needs ANTHROPIC_API_KEY)
 *
 * Output: evals/results-triage-rules.md or evals/results-triage-live.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildBundle } from "../src/lib/data/load";
import { buildModel } from "../src/lib/analytics/model";
import { readLlmConfig } from "../src/lib/ai/anthropic";
import { taxonomyForModel } from "../src/lib/complaints/context";
import { evaluateTriage, reportMarkdown, type TriageEvalCase } from "../src/lib/complaints/evaluate";
import { runTriage, taxonomyFromRequest } from "../src/lib/complaints/llm";
import { redactForAI } from "../src/lib/complaints/redact";
import { localRulesTransport, type TriageTransport } from "../src/lib/complaints/triage";
import type { DatasetKind } from "../src/lib/data/types";

async function main() {
  const live = process.argv.includes("--live");
  const root = path.resolve(__dirname, "..");
  const config = live ? readLlmConfig() : null;
  if (live && !config) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to your environment and try again.");
    process.exit(1);
  }
  const kinds: DatasetKind[] = ["orders", "customers", "invoices", "targets", "complaints"];
  const res = buildBundle(Object.fromEntries(kinds.map((k) => [k, readFileSync(path.join(root, "public/sample-data", `${k}.csv`), "utf8")])), "sample");
  if (!res.bundle) throw new Error(res.blockingErrors.join("; "));
  const model = buildModel(res.bundle);
  const tax = taxonomyForModel(model);
  const cases = (JSON.parse(readFileSync(path.join(root, "evals/complaint_triage.json"), "utf8")) as { cases: TriageEvalCase[] }).cases;

  // Live mode goes through the same server-side function as the API route, including server redaction.
  const transport: TriageTransport = live
    ? async (req) => runTriage({ ...req, text: redactForAI(req.text).text }, taxonomyFromRequest(req, tax), { config })
    : localRulesTransport(tax);
  const report = await evaluateTriage(model, cases, tax, transport, live ? "live" : "rules (no AI)");
  const md = reportMarkdown(report, { date: new Date().toISOString().slice(0, 10), model: config?.model });
  const out = path.join(root, "evals", live ? "results-triage-live.md" : "results-triage-rules.md");
  writeFileSync(out, md);
  console.log(md.split("## Per category")[0]);
  console.log(`Report: ${path.relative(root, out)}`);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
