# Offering this to a manufacturer: pitch and pilot plan

A practical guide for presenting the system to a manufacturing or distribution company and running a pilot on its own data.

## The pitch in one paragraph

Management already has the data in SAP, but answers to "why are sales up while cash is down?", "which distributors need a call this week?" or "what if we collect 30% of the 90+ overdue?" take days of spreadsheet work. This system loads the company's billing, receivables, customer and complaint data each night, calculates the KPIs the same way every time (with the definition one click away), points out what needs attention with the evidence, lets managers test scenarios, and drafts follow-up actions that a named person approves. The AI explains the numbers but never calculates them, every figure it uses is checked automatically, and customer names can be masked before anything leaves the company.

## What to show in the meeting (20 minutes)

1. **Overview** with the sample company: headline KPIs, sales vs target, "needs attention" cards with evidence.
2. **Ask the analyst**: "Why did sales increase while collections fell behind?" Show the fact / possible explanation / recommended step separation and the evidence IDs. Point out the "verified" check.
3. **Customers & partners → health score**: open one account and show exactly which rule deducted points. Then **Settings → Business rules**: their finance team sets the thresholds.
4. **Scenarios**: collect 30% of 90+ overdue; show the arithmetic.
5. **Actions**: approval with a named approver before anything is sent.
6. **Data sources**: how their data gets in (CSV today, SAP nightly) and that the sample can be switched off.
7. **Management report**: print-ready monthly summary.

The [demo script](DEMO_SCRIPT.md) has the exact clicks.

## What the company provides

| Item | Who | When |
|---|---|---|
| A server or VM (or approval to use a cloud VM) with Docker | IT | Week 1 |
| SAP extracts for one company code, 24–36 months (see [SAP_INTEGRATION.md](SAP_INTEGRATION.md)) | SAP key user / Basis | Week 1 |
| Code lists: regions/sales districts, customer groups, distribution channels, material groups, payment terms, QM codes | Sales ops | Week 1 |
| Monthly targets by region (sales, collections) | Sales controlling / finance | Week 1–2 |
| A finance contact to reconcile figures with their reports | Finance | Week 2 |
| Agreement on thresholds (overdue, sales drop, credit use, complaint spikes) | Sales + finance heads | Week 2 |
| Decision on AI: demo mode only, or live with name replacement | IT / management | Week 2 |

## Pilot plan (4–6 weeks)

| Week | Activity | Exit criterion |
|---|---|---|
| 1 | Install with Docker; first manual SE16N export; run `sap_pipeline.py`; load through **Data sources** | All required datasets load with no row errors |
| 2 | **Reconcile**: net sales by month vs VF05/BI report; open items and aging vs FBL5N at a fixed date; adjust `config.json` | Differences explained or under an agreed tolerance |
| 3 | Agree business rules and fiscal year in Settings; schedule the nightly export and pipeline | Nightly load runs unattended for 5 days |
| 4–5 | Managers use it weekly: overview, receivables follow-up, management report | Usage and feedback recorded |
| 6 | Review: what was used, what was wrong, what to add | Go / no-go for rollout |

## How to measure value honestly

Agree measures **before** the pilot and compare with the period before. Do not promise figures in advance. Candidates:

- Hours per month spent preparing the sales/receivables pack (before vs after).
- Days from month end to management pack.
- Number of overdue accounts contacted within a week of becoming 60+ days overdue.
- Overdue 90+ balance and DSO trend (influenced by many factors; treat as context, not proof).
- Manager feedback: which pages and answers they trusted and used.

## Commercial structure options

Common ways to price this kind of work (choose with your own advice; this is not a recommendation):

- **Fixed-fee pilot** covering installation, SAP mapping and reconciliation, then
- **Annual licence or subscription** per company or per user, plus
- **Support and change requests** (new reports, new data sources) on a retainer or day rate.

Make clear in the proposal which costs the company carries directly (server, AI provider usage if live mode is enabled).

## What to be candid about

- It has been tested on synthetic data and synthetic SAP extracts, not yet on a real SAP system. The pilot's reconciliation week exists for this reason.
- The health score and flags are transparent rules for prioritisation, not a validated prediction model.
- Forecasts are baselines, shown with their backtest error.
- Basic sign-in is included; single sign-on and roles are recommended for a wider rollout ([SECURITY.md](SECURITY.md)).
- Live AI explanations need an API key and send aggregated evidence (with names masked by default) to the AI provider.

## Before using the company's data

Get written approval for the data you will receive, keep it on the company's server, never copy it into the public repository or a demo deployment, and delete local extracts after the pilot.
