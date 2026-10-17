# Interview guide: explaining the architecture

A guide for discussing the project in an AI Solutions Engineer or AI-in-Business interview. Answers are written to be said aloud, in about 30–60 seconds each.

## The one-minute explanation

"It's a decision-intelligence app for SME distributors. The key design choice is separating calculation from explanation. A deterministic analytics engine in TypeScript computes every KPI. It's pure functions, tested, and cross-checked against an independent pandas implementation. When a manager asks a question, rule-based routing picks the analyses, the engine produces an evidence packet where every number has an ID, and only that packet goes to the language model. The model must return a structured answer through a forced tool call, citing evidence IDs, and separating facts from hypotheses and recommendations. The server validates the JSON and runs a grounding check that rejects any number not in the evidence. Without an API key it falls back to a clearly labelled template explainer. Actions like overdue alerts go to n8n only after a named person approves the payload."

## Likely questions

**Why not let the LLM query the data directly (text-to-SQL or code execution)?**
Because the KPIs need to be right every time and explainable to finance. Generated queries can be subtly wrong (wrong date field, cancelled orders included, double-counted payments). Here, definitions like "collections are counted by payment date" are implemented once and tested. The LLM's job is narrower (interpretation and wording), which is where it is strong. Text-to-SQL could be added for exploratory questions later, with results labelled as unverified.

**How do you stop hallucinated numbers?**
Three layers. First, the model only receives evidence, not raw data. Second, the output schema forces citations for every fact. Third, the grounding check extracts every number from the answer, normalises units (PKR, M/B, %, days) and accepts it only if it matches an evidence value within the rounding implied by how it was written. Invented or self-calculated numbers fail, and the UI shows that. It doesn't prove the interpretation is sensible, which is why facts and hypotheses are separated and the evidence ledger is always visible.

**Why rule-based routing instead of an LLM router or agents?**
Predictability, cost and testability. The evaluation set checks routing for 14 realistic questions. An LLM router would handle more phrasings; I would add it as a fallback only when no rule matches, and only if it beats the rules on the same evaluation set. A multi-agent setup would add latency and failure modes without improving accuracy for this scope.

**Why TypeScript for analytics instead of Python?**
One deployable on Vercel, and the same functions run in the browser (so uploaded data stays local), on the server and in tests. Python is used where it adds value: a seeded data generator and the independent reference implementation the tests compare against.

**How did you choose methods?**
The simplest method that answers the question. Descriptive aggregation for performance. Contribution-to-change for "where did it come from", explicitly not causal. A modified z-score with median and MAD for unusual months, because a mean-based z-score is distorted by the outliers it's looking for. Transparent rules for account health, because there are no labelled default or churn outcomes to train or validate a model on. For forecasting, four baselines compared on a rolling backtest; with 33 months of data a complex model would mostly fit noise, so I report the best baseline with its error.

**What does the health score mean? Is it machine learning?**
No. It's a rule set: start at 100 and deduct for overdue share, oldest overdue invoice, order recency relative to the account's own rhythm, sales trend, credit utilisation and open high-severity complaints. Each deduction shows its evidence. It's a way to prioritise conversations, not a prediction. To make it predictive you would need historical outcomes and a proper validation.

**How did you test it?**
A small hand-built fixture where every expected value can be checked by hand; tests for filters, aging boundaries, validation edge cases, scenarios; the pandas cross-check on four filter combinations; and an evaluation harness for the AI layer that checks routing, required evidence, data expectations and grounding. Demo-mode evaluation is grounded by construction, so the meaningful AI test is the live run, which I'd track per model version.

**What would you change for production?**
Authentication and per-organisation storage; server-side evidence computation from stored data; a payments table and ERP mapping (I've worked as an SAP SD core user, so I'd map from SD billing and FI clearing data); durable rate limiting and audit logs; live evaluations in CI; and a pilot that measures the value hypotheses in the business case rather than assuming them.

**What was hardest?**
Making the numbers consistent across pages under filters. For example, receivables must be a snapshot "as of" the period end that includes older invoices, while sales are counted by order date and collections by payment date. Writing those rules once in a shared filter module, and reconstructing balances from payment dates, fixed that.

## Things to be ready to show in the code

- `src/lib/analytics/filters.ts`: the shared period and filter rules.
- `src/lib/analytics/receivables.ts`: `outstandingAsOf` (as-of reconstruction).
- `src/lib/ai/evidence.ts` → `prompt.ts` → `anthropic.ts` → `grounding.ts`: the full AI path.
- `tests/reference.test.ts`: the cross-language check.
- `evals/questions.json`: the evaluation set.

## Honest boundaries to state if asked

- Synthetic data; no accuracy or business-impact claims.
- The live AI evaluation needs to be run with a key and recorded per model version.
- The n8n workflow is a template; it has not been run against a live n8n instance in this project.
