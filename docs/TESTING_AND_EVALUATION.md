# Testing and evaluation

## Running the checks

```bash
npm test              # all Vitest suites
npm run typecheck     # strict TypeScript
npm run eval          # AI analyst evaluation, demo mode → evals/results-demo.md
npm run eval:live     # same, against the live model (needs ANTHROPIC_API_KEY) → evals/results-live.md
npm run build         # production build (also type-checks pages)
```

## What the tests cover

| Suite | Covers |
|---|---|
| `kpis.test.ts` | Net sales (cancelled excluded), COGS, margin, discount, collections by payment date, targets and attainment, outstanding/overdue, invoice paid ratio, open complaints, partial-month target pro-rating, target hiding under channel/product filters, as-of reconstruction, empty periods, missing targets/complaints |
| `filters-receivables.test.ts` | Date helpers (real dates, leap years, previous period), date/region/channel/category filtering applied consistently to sales, collections and receivables, default period, aging bucket boundaries, buckets summing to outstanding, aging at a later snapshot, receivables by customer and region, overpaid invoices |
| `csv-validation.test.ts` | Quoted fields, embedded commas/newlines, BOM, malformed rows, invalid dates, negative values, missing values, duplicates (single and composite keys), missing columns, empty files, due-before-invoice, payment without date, thousands separators, cross-file consistency |
| `concentration-scenarios.test.ts` | Top-N shares, HHI, Pareto count, empty data, contribution to change, all four scenarios with hand-calculated expected values, zero-change scenario |
| `intelligence.test.ts` | Health-score deductions and evidence, insufficient-data handling, band distribution, modified z-score, forecast methods and backtest selection, complaint spike detection, product flags, sales-vs-collections diagnosis, overview insights |
| `reference.test.ts` | Engine vs independent pandas implementation on four filter combinations: net sales, COGS, order count, collections, outstanding, overdue, all aging buckets, invoice paid ratio, top-5 share, HHI, targets, open complaints |
| `ai.test.ts` | Router (routing, percentages, region/quarter extraction, fallback), evidence packets (schema, IDs, values), grounding (accepts evidence numbers; rejects invented numbers, self-calculated percentages, unknown IDs, uncited facts; warns on causal facts), demo mode labelling, provider failure fallback, structured provider response parsing (mocked HTTP), schema rejection, grounded demo answers for all 11 analysis types, and the 14-case evaluation set |
| `actions.test.ts` | Action proposals respect thresholds, unique IDs, approval required with a named approver, rate limiter |
| `erp.test.ts` | Real-export handling: delimiters, SAP ruler lines, trailing minus, DMY/MDY/YYYYMMDD dates, business and SAP column names, dataset detection, defaults (region/channel from customer, due date from terms), credit notes reducing sales, several payments per invoice, credit notes not counted as collections, currency and fiscal-year handling, configurable rules, settings validation, name anonymisation round trip, and the example ERP exports in `data/example_exports/` producing the same KPIs as the sample |
| `server.test.ts` | Server storage (save, manifest, previous-version restore, delete), ingest replace and append-by-key, rejection of invalid loads without touching current data, JSON bodies, drop-folder import to processed/failed with a log, token checks |
| `pipeline.test.ts` | Runs `pipeline/sap_pipeline.py` on the synthetic SAP extracts in `data/sap_sample/` and checks that the app computes the same KPIs as from the original sample (skipped when Python/pandas are unavailable) |

The fixture in `tests/fixtures.ts` is small enough that every expected value can be checked by hand; comments next to each record show the numbers.

## The evaluation set

`evals/questions.json` holds 14 realistic management questions. For each, the harness (`src/lib/ai/evals.ts`) checks:

1. **Routing**: the expected analyses ran (and filters/percentages were extracted where relevant).
2. **Evidence**: required evidence items are present.
3. **Data expectations**: numeric checks that were confirmed independently (e.g. Q3-2026 sales attainment > 100% and collection attainment < 100%; South has a negative collection gap; the P009 margin is below the portfolio margin; the P013 complaint spike has ≥ 3 complaints).
4. **Grounding**: no unverified numbers, no unknown evidence IDs, every fact cites evidence.
5. **Completeness**: hypotheses and recommendations are present where the question calls for them.

### How to read the results honestly

- **Demo mode** (`npm run eval`) tests routing, evidence and data expectations end to end. The demo explainer only restates evidence, so its grounding pass is expected by construction; it does *not* measure language-model behaviour.
- **Live mode** (`npm run eval:live`) is the real test of the AI layer: the same cases, the same grounding check, a real model. Record the results file with the model name and date. Failures to look for: invented or recalculated numbers, causal claims stated as facts, missing citations, and recommendations not tied to evidence.

## Verification status of this repository

The development environment for this project could not reach the npm registry, so Next.js, Recharts and Vitest could not be installed there. What was actually run:

| Check | Status during development | How |
|---|---|---|
| Synthetic data generation | Run | Python 3 + pandas |
| Pandas reference KPIs | Run | `scripts/reference_kpis.py` |
| All 182 tests in 11 suites (including the SAP pipeline test with Python + pandas) | Run, all passing | The unchanged test files, executed with `tsx` and a minimal Vitest-compatible shim |
| Strict type-check of all source, tests and scripts | Run, clean | TypeScript compiler with real Zod, Node and React 19 types; Next.js and Recharts declared loosely because they could not be installed |
| Evaluation set (demo mode) | Run, 14/14 | `scripts/run-evals.ts` |
| Company-data journey: welcome with sample switched off → setup wizard → CSV upload with column matching → server storage → all pages; SAP pipeline `--push` to the ingest API; wrong token rejected; drop-folder import and failure log; desktop and 390 px mobile widths | Run against the real API route handlers (served by a small Node harness), in headless Chromium |
| UI rendering of all pages, filters, Ask flow, mobile width | Run | esbuild bundle of the real components with `next/link`, `next/navigation` and `recharts` stubbed; screenshots in headless Chromium |
| `npm test` with real Vitest | **Not run yet** | Run on your machine or in CI |
| `next build`, type-check against real Next.js and Recharts types | **Not run yet** | Run on your machine or in CI |
| Charts rendered by Recharts | **Not seen yet** | Charts were placeholders in the offline preview |
| Live LLM evaluation | **Not run** | No API key in the development environment |
| Vercel deployment | **Not done** | See DEPLOYMENT.md |
| Docker image build | **Not run** | No Docker in the development environment; build once on the target server or in CI |
| Real SAP system extracts | **Not run** | Only synthetic SAP-format extracts; the pilot includes a reconciliation week |
| Basic-auth middleware in a running Next.js server | **Not run** | Logic reviewed; verify after the first deployment |

The GitHub Actions workflow in `.github/workflows/ci.yml` runs `npm ci`/`install`, type-check, tests and build on every push, which closes the first three open items as soon as the repository is pushed.
