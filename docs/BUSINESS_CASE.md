# Business case

## The problem

Small and medium-sized manufacturers and distributors (tiles, building materials, FMCG distribution, industrial supplies) usually have the data they need in an ERP or accounting system, but turning it into decisions is slow:

- Sales, finance and operations each look at different reports, so a question like "why did sales grow while cash did not?" needs several exports and a spreadsheet.
- Dashboards show *what* happened but not *where it came from* or *what to do next*.
- Credit risk is noticed late: overdue balances are reviewed monthly, after they have aged.
- Quality problems are seen complaint by complaint, not as a pattern across customers.
- Generic AI chat tools are tempting but unreliable with numbers, and cannot be trusted for figures used in a credit or pricing decision.

## Target users

| User | Typical question | What they get |
|---|---|---|
| Sales or commercial manager | Which regions and distributors need attention this week? | Region gaps, health scores with evidence, follow-up tasks |
| Finance / credit control | Who is overdue, how old is it, what if we push collections? | As-of aging, overdue movers, collection scenarios, alerts |
| Operations / quality lead | Which complaints are open and is there a pattern? | Open list by team, spike detection, routing |
| Owner / general manager | What happened this quarter and what should we do? | Overview findings and a grounded Q&A |

## The solution

A single web application that combines tested analytics, transparent business rules, an AI explanation layer that can only use verified numbers, what-if scenarios, and human-approved workflow actions. It runs on CSV exports, so it does not require changing the ERP, and it is useful without an AI key.

## Potential value (to be measured, not claimed)

No measured return on investment exists for this project: it uses synthetic data and has not been piloted. The value hypotheses below are what a pilot should measure.

| Hypothesis | How to measure in a pilot |
|---|---|
| Faster answers to recurring management questions | Time from question to answer before vs after, for a fixed set of questions |
| Earlier action on overdue balances | Days from an invoice becoming overdue to first follow-up; share of balance moving into 90+ days |
| Better collection against target | Collection attainment over several quarters, compared with prior periods (allowing for market conditions) |
| Earlier detection of quality clusters | Days from first complaint in a cluster to quality investigation |
| Fewer spreadsheet reconciliations | Number of manual reports replaced |
| Trust in AI-assisted answers | Share of answers where the grounding check passes; manager rating of usefulness |

## Why this design is credible

- Numbers are reproducible and tested, including against a second, independent implementation.
- AI output is constrained, cited and checked; uncertainty is shown, not hidden.
- Every rule and threshold is visible and adjustable by the business.
- Consequential actions require a named human approval.

## Risks and mitigations

| Risk | Mitigation |
|---|---|
| Poor source-data quality | Validation with row-level errors; cross-file checks; documented limitations |
| Over-trust in AI explanations | Facts vs hypotheses separation, citations, grounding check, demo-mode labelling |
| Rules that do not fit the business | Thresholds are explicit and meant to be tuned with sales and finance |
| Data privacy | Browser-side processing; only aggregated evidence sent to the AI provider; authentication needed before real use |
