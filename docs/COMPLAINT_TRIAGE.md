# Complaint triage module

The complaint module turns unstructured customer complaints into structured, traceable cases and connects them to the rest of the decision-intelligence system. It is built into the existing app (same data model, analytics engine, AI client, storage and design), not a separate application.

```
complaint received ─► AI assessment (suggestion) + deterministic business rules
      ─► human review (confirmed category, priority, department, owner)
      ─► investigation ─► awaiting customer ─► resolved ─► closed
      ─► management insights and the AI analyst
```

## 1. Where things live

| Piece | File(s) |
|---|---|
| Case, assessment and action schemas | `src/lib/complaints/types.ts` |
| Categories and departments | `src/lib/complaints/taxonomy.ts` |
| Workflow: creation, transitions, decisions, duplicates | `src/lib/complaints/workflow.ts` |
| Business rules | `src/lib/complaints/rules.ts` |
| Redaction before AI | `src/lib/complaints/redact.ts` |
| AI triage (prompt, tool schema, validation, guards, fallback on failure) | `src/lib/complaints/llm.ts` |
| Rule-based fallback classifier | `src/lib/complaints/fallback.ts` |
| Orchestration (request → AI → rules → suggestion) | `src/lib/complaints/triage.ts` |
| Linking to customers, orders, invoices, products | `src/lib/complaints/context.ts` |
| Register merged into the analytics model | `src/lib/complaints/merge.ts` |
| Management insights | `src/lib/complaints/insights.ts` |
| Sample register and evaluation | `src/lib/complaints/seed.ts`, `evaluate.ts` |
| Server register | `src/lib/server/caseStore.ts`, `src/app/api/complaints/**` |
| Browser register | `src/lib/client/caseStore.ts` |
| Screens | `src/components/views/ComplaintsView.tsx`, `src/components/complaints/*` |

## 2. Data model and persistence

**The imported complaints dataset is never changed.** `complaints.csv` (or SAP QM notifications from the pipeline) has no customer text in the sample, and its columns are left exactly as they are. The module adds a **complaint register**: one *case* per complaint, either linked to an imported complaint (`linkedComplaintId`, same ID) or entered in the app (IDs `CR-YY-NNNN`).

A case holds:

- intake fields: received date, channel, customer (ID from the master, or a free-text name), order / invoice / product references, claim value, contact name, supporting information;
- `originalText`: the customer's words, stored once and **never edited**;
- reference checks made at intake (found, not found, belongs to another customer);
- `assessments[]`: every AI or rule-based assessment, with mode, model, prompt version, the redacted text that was analysed, the rules that fired and the combined suggestion;
- `confirmed`: the reviewer's decision (category, secondary category, priority, department, owner), who and when, a reason when priority was set below the rule minimum, and whether it agreed with the suggestion;
- `escalation`: whether management review is required, why, and who acknowledged it;
- `response`: the draft reply (AI, rules or person) and the approved text;
- `resolution`, `status`, `history[]` (append-only) and a `version` number.

**Storage:**

| Deployment | Register location | Shared? |
|---|---|---|
| Company server (`DATA_DIR`) | `DATA_DIR/complaints/cases.json` (+ `cases.prev.json`), written atomically through `/api/complaints/cases` | Yes, all users |
| No server storage (e.g. Vercel) | Browser IndexedDB, namespace `company` | This browser only |
| Sample data | Browser IndexedDB, namespace `sample`, seeded with synthetic cases | This browser only |

**Persistence limitations (stated plainly):** the server register is a JSON file. Changes are serialised inside one server process and protected by a per-case version number (two people editing the same case get a "changed by someone else" message instead of overwriting each other). It is suitable for one app instance and hundreds to a few thousand cases. Several app instances writing the same folder, very large volumes or reporting from other tools would need a database (Postgres is the natural next step; the workflow functions are storage-independent). "Remove all company data" also removes the register.

**How the register feeds analytics.** `withCases()` merges the register into the shared model so Overview, the management report and the AI analyst count complaints entered in the app. For imported complaints, only decisions **a person** made (confirmed classification, status changes) are applied in this app; unconfirmed AI suggestions never change imported values. The case view shows the source record next to the register values.

## 3. Workflow and controls

| From | Allowed to | Conditions |
|---|---|---|
| New | Under Investigation, Awaiting Customer | Triage confirmed by a person |
| AI Reviewed | Under Investigation, Awaiting Customer | Triage confirmed by a person |
| Under Investigation | Awaiting Customer, Resolved | Resolve: resolution note; escalation acknowledged |
| Awaiting Customer | Under Investigation, Resolved | As above |
| Resolved | Closed, Under Investigation (reopen) | Reopen: reason |
| Closed | Under Investigation (reopen) | Reason |

"AI Reviewed" is set only by recording an assessment. Enforced in `workflow.ts` (used by both the server and the browser), not just in the UI:

- every decision needs a named person ("Acting as" in the page header, remembered in the browser; in a company deployment this would come from single sign-on);
- the AI or rule engine can only **add a suggestion**. It cannot confirm triage, change status, approve or send a reply, close a case, approve refunds or touch financial data;
- setting a priority below the business-rule minimum needs a written reason, kept in the history;
- an escalated case cannot be resolved until management acknowledges it with a note;
- a reply can be approved only after triage is confirmed; approval does **not** send anything;
- duplicate submissions are blocked (one-time submission key) and a second case for the same imported complaint is refused; near-duplicates (same customer, very similar text or same order, within 30 days) are flagged at intake and on the case.

## 4. AI triage

**What is sent.** The complaint text and supporting information after redaction (customer name, contact name, phone numbers, e-mail addresses, national ID, card and bank numbers removed in the browser and again on the server); channel and date; product name and category; customer type, region, number of complaints in the last 12 months and whether it is an important account; whether an order / invoice reference exists; the allowed categories and departments; response-time targets. **Not sent:** amounts, invoices, balances, customer names, contact details.

**How.** One Anthropic Messages API call with a forced tool call (`submit_triage`) whose JSON schema restricts categories and departments to the allowed lists. The answer is validated with Zod. Then:

- labels are matched case-insensitively; anything not allowed is rejected as malformed;
- a safety concern forces Critical;
- the draft reply is scanned for commitments (refunds, replacements, compensation, dates). If it contains one, it is replaced with a neutral template and the reviewer is told.

**Output fields:** primary and secondary category, the separate issues raised, summary, sentiment and frustration (tone), severity and business impact (substance), urgency and response time, priority, department, next actions, draft reply, escalation recommendation and reason, safety flag, confidence (Low / Medium / High) with the reason, information still needed, and whether the text contained instructions to the system.

**Confidence** is the model's qualitative judgement, shown as Low / Medium / High with its explanation. It is not a calibrated probability, and the UI says so.

**Untrusted input.** The complaint is placed inside `<complaint>` tags (tags inside the text are stripped). The system prompt says the text is data, not instructions. The model has no tools that act on anything, and an injection detector flags wording addressed to the system. Even a successful injection could only change a suggestion that a person must confirm, and the rules below cannot be lowered by it.

**Failures.** Missing API key, timeout, network error, HTTP 4xx/5xx including 429, invalid JSON, missing tool output and schema violations all lead to a **rule-based suggestion** clearly labelled "no AI model was called". A failure event is added to the history and the reviewer gets a **Retry** button. Manual triage always works.

**Rule-based fallback.** Keyword scoring per category, a small sentiment lexicon and fixed templates. It is transparent but much weaker than a model (misses paraphrases, multi-issue complaints and conduct issues; see the evaluation).

## 5. Business rules (deterministic)

Rules can only **raise** priority and **add** escalation; they never lower the AI suggestion. Every rule that fires is shown on the case. Thresholds are editable in **Settings → Business rules → Complaints and triage**.

| Rule | Trigger | Effect |
|---|---|---|
| Possible safety risk | Injury, slipping, tripping, falling tiles, hospital, hazard and similar, or category Product Safety | Critical, escalate, department Quality |
| Legal exposure | Lawyer, legal notice, court, FIR and similar | At least High, escalate |
| Customer retention risk | Threat to stop buying, switch supplier, cancel orders | At least High, escalate |
| High claim value | Claim ≥ threshold (default 250,000) | At least High |
| Important account | Key account, institutional, or top 10 by 12-month sales | At least Medium |
| Repeated issue | Same customer, same category within the window (default 90 days), excluding follow-ups on the same order | At least High |
| Repeat complainant | Same customer, any category, within the window | At least Medium |
| Possible systemic issue | Product-related category (Quality / Production) with ≥ N complaints on the same product within the window (default 3 in 90 days), or the product's complaint-spike flag for that category | At least High, escalate |
| Contains instructions | Prompt-injection wording | Flag for careful review |
| Personal data in text | Contact details or identifiers found | Flag; removed before analysis |

Response-time targets by priority (defaults: Critical 24 h, High 48 h, Medium 120 h, Low 240 h) drive the "past first-response target" count: open cases with no human decision yet within the target.

## 6. Linking and management insights

Links use exact IDs only: customer master, order, invoices for that order, product, the imported complaint, related complaints for the same customer (12 months) and the same product (±90 days). Customer context includes segment, region, health band, 90-day sales trend, overdue balance and sales rank. Unknown references stay on the case as "unverified" with a note; nothing is matched by name.

Management insights (**Complaints → Management insights**, all following the period and region / channel / category filters):

- open complaints, period volume, average resolution time (only for complaints with both dates), open claim value;
- monthly volume; categories in the last 90 days vs the 90 before, with a transparent "increasing" rule;
- complaints by region and customer segment; open complaints by priority and age;
- recurring product issues and complaint spikes;
- repeat complainants;
- customers with elevated complaint risk (transparent points);
- **complaints and sales: an association.** The median 90-day sales change for customers with vs without a recent complaint, with *n*. It is labelled as an association: it does not show that complaints caused any sales change.

The queue page adds the operational view: escalated cases awaiting management, suggestions awaiting review, not yet triaged, past the response target, and a priority × status matrix.

The **management report** includes a complaints section.

## 7. AI analyst integration

Two analyses were added to the existing analyst (router → deterministic evidence → explanation → grounding check):

- `complaint_patterns`: increasing categories, region / segment / product concentration, repeat complainants, recurring issues, and the sales association with sample sizes;
- `complaint_priorities`: open complaints by priority and age, escalations, the most urgent complaints, open complaints by department, customers with elevated risk, complaints with retention or legal signals, and register status (awaiting review, not triaged, past target).

Example questions: "Which complaint categories are increasing?", "Which customers have the most unresolved high-priority complaints?", "Which complaints require immediate management attention?", "Are repeated complaints concentrated in a particular region, product, or customer segment?", "What operational issues should management investigate this month?", "Which complaints may threaten customer retention?", "What actions should the relevant departments prioritize?". Each packet carries the period, counts (*n*) and limitations, and every number in the answer is checked against the evidence. Four of these questions were added to `evals/questions.json` (Q15–Q18).

## 8. Evaluation

`evals/complaint_triage.json` holds **36 hand-written synthetic complaints** with manually defined expected labels:

- E01–E19 are written to match existing synthetic complaints (same customer, order, product and category);
- E20–E36 are new complaints;
- edge cases: vague complaints, multiple issues in one complaint, angry customers with minor issues, calmly worded safety incidents, a duplicate, missing references, two prompt-injection attempts, mixed Urdu/English text, a positive note with a minor defect, legal and retention threats.

Labels include an acceptable alternative category where reasonable reviewers could differ. The same texts seed the demo register.

```bash
npm run eval:triage        # rule-based fallback, no API key → evals/results-triage-rules.md
npm run eval:triage:live   # live model + rules (needs ANTHROPIC_API_KEY) → evals/results-triage-live.md
```

The harness runs each case through the full app pipeline (redaction → triage → rules → suggestion) and reports:

- primary category accuracy (exact, and exact-or-acceptable), and per-category precision, recall and F1 with support. Macro-F1 covers only categories with 3+ cases;
- department accuracy, and priority accuracy (exact and within one level);
- escalation precision and recall, safety detection, embedded-instruction detection and duplicate detection.

**Results so far (rule-based fallback, no AI):**

| Measure | Result |
|---|---|
| Category exact / with acceptable alternative | 83% / 92% |
| Department | 89% |
| Priority exact / within one level | 69% / 97% |
| Escalation recall / precision | 100% (13/13) / 93% |
| Safety, injection, duplicate detection | 2/2, 2/2, 1/1 |

**How to read these honestly:**

- The keyword rules and the labels were written by the same author. Some patterns were adjusted after a first run, including the injection patterns, the threshold for a "large" quantity, and restricting the systemic rule to product categories. So these are optimistic for the fallback and serve as a regression check, not as evidence of quality.
- With 36 synthetic cases and only 3 categories having 3+ examples, per-category F1 is not statistically meaningful.
- **The live model has not been evaluated yet** (no API key in the development environment). Run `npm run eval:triage:live` and record the model name and date before quoting any AI accuracy figure. A credible next step is 200+ real, anonymised complaints labelled by two reviewers, with agreement measured between them.

In the app, the queue also tracks **reviewer agreement** with suggestions (category, priority, department; live AI vs rule-based). This is a practical way to monitor quality in production.

## 9. API

| Route | Purpose |
|---|---|
| `POST /api/complaints/triage` | Stateless triage of one redacted request. Returns `{ mode, model?, assessment, notices, promptVersion, aiFailed? }`. Rate-limited (30 a minute), 30 KB limit. |
| `GET /api/complaints/cases` | Register on this server (server storage only). |
| `POST /api/complaints/cases` | New case (`NewCaseInput`). 201, 400 invalid, 409 duplicate. |
| `PATCH /api/complaints/cases/:id` | `{ action, expectedVersion }`. 200, 400 invalid, 403 not allowed in this state, 404, 409 changed by someone else. |

All are behind the app sign-in when `BASIC_AUTH_*` is set.

## 10. Known limitations

- Synthetic data only; no real complaints have been processed. No accuracy or business-impact claims are made.
- Live-model triage has not been evaluated (see §8).
- Redaction is pattern-based and can miss personal data written in unusual ways.
- Assessments are computed in the browser and posted to the server register. The server validates their structure but does not recompute them (the same trade-off as the existing analyst evidence).
- One shared sign-in. "Acting as" is a typed name, not an authenticated identity; use company SSO for accountability at scale.
- The JSON-file register suits one instance and moderate volumes (see §2).
- Approved replies are not sent; there is no e-mail or WhatsApp integration (the existing n8n hook could be extended).
- Product links depend on the order reference. A complaint without one is not attributed to a product.
- In the SAP-pipeline sample, complaint order references come from QM notifications and may not match billing-document IDs. The case shows "order not found" rather than guessing.
