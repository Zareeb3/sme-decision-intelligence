/**
 * Run the AI analyst evaluation set and write a report.
 *
 *   npm run eval          demo mode (no API key needed, deterministic)
 *   npm run eval:live     live mode: needs ANTHROPIC_API_KEY in the environment
 *
 * Output: evals/results-demo.md or evals/results-live.md
 */
import { readFileSync, writeFileSync } from "node:fs";
import path from "node:path";
import { buildBundle } from "../src/lib/data/load";
import { buildModel } from "../src/lib/analytics/model";
import { defaultFilters } from "../src/lib/analytics/filters";
import { answerFromEvidence } from "../src/lib/ai/ask";
import { readLlmConfig } from "../src/lib/ai/anthropic";
import { runEvalCase, type EvalCase, type EvalOutcome } from "../src/lib/ai/evals";
import type { DatasetKind } from "../src/lib/data/types";

async function main() {
  const live = process.argv.includes("--live");
  const root = path.resolve(__dirname, "..");
  const config = live ? readLlmConfig() : null;
  if (live && !config) {
    console.error("ANTHROPIC_API_KEY is not set. Add it to your environment (or .env.local loaded by your shell) and try again.");
    process.exit(1);
  }

  const kinds: DatasetKind[] = ["orders", "customers", "invoices", "targets", "complaints"];
  const res = buildBundle(Object.fromEntries(kinds.map((k) => [k, readFileSync(path.join(root, "public/sample-data", `${k}.csv`), "utf8")])), "sample");
  if (!res.bundle) throw new Error(res.blockingErrors.join("; "));
  const model = buildModel(res.bundle);
  const base = defaultFilters(model);
  const cases = (JSON.parse(readFileSync(path.join(root, "evals/questions.json"), "utf8")) as { cases: EvalCase[] }).cases;

  const outcomes: EvalOutcome[] = [];
  for (const c of cases) {
    const o = await runEvalCase(model, base, c, (p) => answerFromEvidence(p, { config }));
    outcomes.push(o);
    console.log(`${o.passed ? "PASS" : "FAIL"} ${o.id} [${o.mode}] ${o.question}`);
    for (const f of o.failures) console.log(`     ✗ ${f}`);
    for (const w of o.warnings) console.log(`     ! ${w}`);
  }

  const passed = outcomes.filter((o) => o.passed).length;
  const mode = live ? `live (${config!.model})` : "demo (template explainer, no AI model called)";
  const md = [
    `# AI analyst evaluation — ${mode}`,
    "",
    `Run: ${new Date().toISOString()}  `,
    `Data: bundled synthetic sample, default period ${base.start} to ${base.end}  `,
    `Result: **${passed} / ${outcomes.length} cases passed**`,
    "",
    "| Case | Question | Mode | Analyses | Evidence items | Numbers checked | Result |",
    "|---|---|---|---|---|---|---|",
    ...outcomes.map((o) => `| ${o.id} | ${o.question} | ${o.mode} | ${o.analyses.join(", ")} | ${o.evidenceItems} | ${o.numbersChecked} | ${o.passed ? "pass" : "FAIL"} |`),
    "",
    "## Failures and warnings",
    "",
    ...(outcomes.every((o) => o.passed && o.warnings.length === 0)
      ? ["None."]
      : outcomes.flatMap((o) => [...o.failures.map((f) => `- ${o.id} failure: ${f}`), ...o.warnings.map((w) => `- ${o.id} warning: ${w}`)])),
    "",
  ].join("\n");
  const out = path.join(root, "evals", live ? "results-live.md" : "results-demo.md");
  writeFileSync(out, md);
  console.log(`\n${passed}/${outcomes.length} passed. Report: ${path.relative(root, out)}`);
  process.exit(passed === outcomes.length ? 0 : 1);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
