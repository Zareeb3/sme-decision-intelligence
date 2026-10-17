# AI analyst evaluation — demo (template explainer, no AI model called)

Run: 2026-10-17T02:15:00.303Z  
Data: bundled synthetic sample, default period 2026-07-01 to 2026-09-30  
Result: **14 / 14 cases passed**

| Case | Question | Mode | Analyses | Evidence items | Numbers checked | Result |
|---|---|---|---|---|---|---|
| Q01 | Why did sales increase while collections fell behind? | demo | sales_vs_collections | 25 | 30 | pass |
| Q02 | Which regions, products, channels, and customers are driving or reducing performance? | demo | product_performance, performance_drivers | 29 | 56 | pass |
| Q03 | Which customers contribute the largest share of revenue? | demo | customer_concentration | 11 | 20 | pass |
| Q04 | Which accounts have significant outstanding balances or overdue invoices? | demo | receivables_risk | 15 | 15 | pass |
| Q05 | Which distributors may need attention based on transparent business indicators? | demo | distributor_attention | 10 | 28 | pass |
| Q06 | Which products show declining sales, weak estimated margins, or unusual patterns? | demo | product_performance | 16 | 27 | pass |
| Q07 | What could happen if collections improve by 10%? | demo | collection_scenario | 13 | 10 | pass |
| Q08 | Which operational issues and customer complaints require management attention? | demo | complaints | 12 | 11 | pass |
| Q09 | Which findings are supported by data, and which require further investigation? | demo | data_quality | 6 | 4 | pass |
| Q10 | What should a business manager investigate or do next? | demo | next_steps | 13 | 5 | pass |
| Q11 | How are overdue balances in the South region? | demo | receivables_risk | 15 | 15 | pass |
| Q12 | What is the sales outlook for the next quarter? | demo | forecast | 8 | 14 | pass |
| Q13 | What would happen if we collected 25% more of the overdue amount? | demo | collection_scenario, receivables_risk | 28 | 25 | pass |
| Q14 | Tell me something interesting | demo | next_steps | 13 | 5 | pass |

## Failures and warnings

None.
