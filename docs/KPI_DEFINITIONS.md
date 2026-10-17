# KPI definitions

The same definitions appear in the app (the **?** on each metric) and live in code in `src/lib/analytics/definitions.ts`. Calculations are in `src/lib/analytics/kpis.ts` and `receivables.ts`.

## Period and filter rules

| Concept | Rule |
|---|---|
| Selected period | `[start, end]`, inclusive. Default: the last three complete months in the data. |
| Snapshot date ("as of") | The period end, or the last date in the data if earlier. Used for all balances. |
| Previous period | Same length, immediately before. Whole-month periods compare with whole months (Jul–Sep vs Apr–Jun). |
| Region / channel filters | Applied through the order (or the customer, if an invoice has no matching order). |
| Product / category filters | Applied through the order. Invoices without a matching order are excluded when these filters are on. |
| Targets | Set by region and month. Hidden when a channel or product filter is active. Partial months pro-rated by days. |

## Metrics

| Metric | Definition | Formula | Period | Limitations |
|---|---|---|---|---|
| **Net sales** | Value of delivered orders after discount, less credit notes | Σ `net_sales_pkr` for Delivered lines − Σ for Credit Note lines | Order (billing) date in period | Order-date based; credit notes count in the period they are issued |
| **Estimated COGS** | Estimated cost of goods sold | Σ `est_cogs_pkr` | Same orders | Standard cost estimates, not audited |
| **Estimated gross profit** | Net sales − estimated COGS | | Same orders | Excludes freight, rebates |
| **Estimated gross margin** | Gross profit ÷ net sales × 100 | | Same orders | Inherits cost limitations |
| **Average discount** | Discount as share of list value | 1 − net sales ÷ Σ(quantity × list price) | Same orders | Value-weighted |
| **Sales target attainment** | Net sales ÷ sales target × 100 | | Targets for months in period | Region/month targets only |
| **Collections** | Cash received | Σ payments with `payment_type = Payment` and `payment_date` in period (from payments.csv; otherwise the invoice's paid amount and date) | Payment date in period | Credit notes reduce balances but are not cash |
| **Collection target attainment** | Collections ÷ collection target × 100 | | As above | As above |
| **Outstanding receivables** | Unpaid balance at the snapshot | Σ max(0, amount − payments and credit notes on or before snapshot), invoices dated on or before snapshot | Snapshot (includes invoices from before the period) | Unapplied cash not modelled |
| **Overdue balance** | Outstanding on invoices past due | Σ outstanding where `due_date` < snapshot | Snapshot | Agreed extensions not recorded |
| **Overdue share** | Overdue ÷ outstanding × 100 | | Snapshot | Falls when recent invoicing rises, even if old debts remain |
| **90+ days past due** | Outstanding more than 90 days past due | | Snapshot | |
| **Aging buckets** | Not yet due; 1–30; 31–60; 61–90; 90+ days past due | days = snapshot − due date | Snapshot | Buckets always sum to outstanding (tested) |
| **Invoice paid ratio** | Share of invoices raised in the period that are fully paid at the snapshot | count(fully paid) ÷ count(raised) × 100 | Raised in period | Recent, not-yet-due invoices lower it |
| **Invoice value paid** | Share of invoiced value received by the snapshot | Σ paid ÷ Σ invoiced × 100 | Raised in period | Same caveat |
| **Simple DSO (90-day)** | Days of sales held in receivables | outstanding ÷ (net sales of last 90 days ÷ 90) | 90 days to snapshot | Average method; count-back is more precise for volatile sales |
| **Top-N customer share** | Share of net sales from the N largest customers | | Orders in period | Related accounts not grouped |
| **HHI** | Σ (customer share %)², 0–10,000 | | Orders in period | Thresholds (1,500 / 2,500) borrowed from competition analysis; used only as a rough guide |
| **Customers for 80%** | Smallest number of customers whose sales reach 80% | | Orders in period | |
| **Open complaints** | Opened on or before the snapshot and not resolved by it | | Snapshot | Depends on status upkeep |
| **Average resolution time** | Mean days from opened to resolved | | Resolved in period | |

## Rule-based indicators (not KPIs)

All thresholds below are the defaults. Each company can change them in **Settings → Business rules**; the app always shows the rule text with the values in force.

**Fiscal year.** Quarter and year presets follow the fiscal-year start month in Settings. A fiscal year is named by the calendar year in which it ends (July start: Jul 2026 – Jun 2027 is FY2027, Jul–Sep 2026 is FY2027-Q1).

### Account health score (`customers.ts`)

Starts at 100. Deductions, each shown with its evidence:

| Rule | Deduction |
|---|---|
| Overdue share of outstanding > 50% / > 25% | −20 / −10 |
| Oldest overdue invoice > 90 / > 60 days past due | −20 / −10 |
| Days since last order > 3× the account's usual gap (and > 60 days) / > 2× (and > 45 days) | −20 / −10 |
| Net sales last 90 days vs previous 90 down > 30% / > 10% | −15 / −5 |
| Outstanding > 100% / > 80% of credit limit | −15 / −5 |
| One or more open high-severity complaints | −5 |

Bands: 80+ Healthy, 60–79 Watch, below 60 Needs attention. Accounts with fewer than 3 orders in 12 months and no balance are "Insufficient data". **This is a prioritisation aid, not a validated prediction.** Thresholds are starting assumptions to tune with sales and finance.

### Product flags (`products.ts`)
Sales down > 15% vs previous period (if the product had ≥ 1% of previous sales); margin > 5 pts below portfolio; margin down > 3 pts.

### Unusual months (`anomalies.ts`)
Modified z-score = 0.6745 × (x − median) / MAD over the previous 12 months (minimum 6); flagged above 3.5 (Iglewicz & Hoaglin).

### Complaint spike (`complaints.ts`)
At least 3 complaints for a product in the last 60 days and at least 3× its average 60-day count over the prior 12 months.

### Forecast (`forecast.ts`)
Naive, 3-month moving average, seasonal naive and seasonal naive × year-on-year trend are each backtested on the last 6 months (one-step-ahead, rolling origin). The method with the lowest mean absolute percentage error is used for a 3-month outlook; the range shown is ± the largest backtest error. Minimum 18 months of history.
