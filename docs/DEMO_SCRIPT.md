# Two-minute demo script

Figures below are from the bundled synthetic data with the default period (Jul–Sep 2026). Practise once with the app open; numbers on screen are the source of truth.

**0:00 – Set up the problem (15 s)**
"Mid-sized distributors run on ERP exports and spreadsheets. Managers get numbers, but not 'what changed, why might it matter and what do we do'. This is a decision-support app for a fictional Pakistani tile company. All data is synthetic."

**0:15 – Overview (25 s)**
Point at the KPI row. "Sales hit 115% of target at PKR 929M, but collections reached only 94% of target and overdue grew from PKR 169M to 213M." Hover a **?**: "Every metric carries its definition, formula and limitations." Point at *What needs attention*: "These are rule-based findings, not AI: what happened, why it matters, the evidence and the next step."

**0:40 – Ask the analyst (35 s)**
Click *Why did sales increase while collections fell behind?*
"The question is routed to a diagnostic analysis. The analytics engine computes about 25 verified numbers, this evidence ledger. The AI may only use these numbers and must cite them." Hover a citation chip to highlight the ledger row. "Facts, possible explanations with how to verify them, and recommendations are kept separate. The grounding check confirms every number matches the evidence. Without an API key it says clearly that it is in demo mode."

**1:15 – Customers and receivables (20 s)**
Customers page: open a distributor in *Needs attention*. "The health score is transparent: each deduction shows its evidence. It is a prioritisation aid, not a prediction." Receivables: "South holds the largest overdue balance; these accounts grew most."

**1:35 – Scenario and action (20 s)**
Scenarios: "If we collect 10% more of the overdue balance, collections rise by about PKR 21M. It is labelled as a hypothetical calculation, not a forecast." Actions: "The app proposes follow-ups, but nothing is sent until a named person approves the exact payload; n8n then handles the email or task."

**1:55 – Close (5 s)**
"Deterministic analytics for the numbers, AI for the explanation, people for the decisions, tested against an independent pandas implementation."

## Complaint triage (2 min)
Complaints → **Triage queue**: "Every complaint is a case. Escalations first: two product-safety reports — one calmly worded — were made Critical by a business rule, whatever tone the customer used." Open **CR-26-0001**: original text on top, unchanged; below it the suggestion, clearly labelled (rule-based without a key, AI with one), the rules that fired, and *what was sent* — the phone number was removed. Type a name in **Acting as**, confirm the triage, acknowledge the escalation, move to investigation; then try **Resolve** without a note: blocked. Open **CR-26-0007**: the complaint tries to instruct the system to close itself and approve a refund — flagged, ignored. **Management insights**: shade variation on GVT Marble Glossy is rising across 9 customers; customers with elevated complaint risk; complaints vs sales shown as an association, not a cause. Ask the analyst: *Which complaints require immediate management attention?*

## If asked "how do we get our data in?" (1 min)
Data sources → **Automated pipeline** tab: "Nightly SAP extract, our script maps your codes, and the app validates and loads it; invalid loads never replace good data, and each dataset can be restored to its previous version." Then **Upload** tab: drop `data/example_exports/sales_register_export.csv` (semicolon-separated, day-first dates, business column names) and open **Columns** to show the automatic matching. Settings: "Your currency, fiscal year and thresholds; the sample company can be switched off entirely."

## If asked a follow-up
- *Data quality?* Data page → upload `messy/orders_with_errors.csv` with the sample customers and invoices: row-level errors with line numbers.
- *Filters?* Choose Region: South; every KPI and chart updates consistently.
- *Forecasting?* Sales page → four baselines compared on a 6-month backtest, with error shown.
