/**
 * Metric registry: one definition per KPI, shown in the UI ("How is this
 * calculated?") and mirrored in docs/KPI_DEFINITIONS.md.
 */

export interface MetricDefinition {
  id: string;
  name: string;
  definition: string;
  formula: string;
  period: string;
  limitations: string;
}

export const METRICS: Record<string, MetricDefinition> = {
  netSales: {
    id: "netSales",
    name: "Net sales",
    definition: "Value of delivered orders after discounts. Cancelled orders are excluded.",
    formula: "Σ net_sales_pkr for orders with order_status = Delivered",
    period: "Orders whose order date falls in the selected period.",
    limitations: "Order-date based (not invoice or dispatch date). Excludes returns and credit notes, which are not in the dataset.",
  },
  estGrossProfit: {
    id: "estGrossProfit",
    name: "Estimated gross profit",
    definition: "Net sales minus estimated cost of goods sold.",
    formula: "Σ net_sales_pkr − Σ est_cogs_pkr",
    period: "Same orders as net sales.",
    limitations: "Uses estimated standard unit costs per order line, not audited actual costs. Freight and rebates are not included.",
  },
  estGrossMarginPct: {
    id: "estGrossMarginPct",
    name: "Estimated gross margin",
    definition: "Estimated gross profit as a percentage of net sales.",
    formula: "estimated gross profit ÷ net sales × 100",
    period: "Same orders as net sales.",
    limitations: "Inherits the cost-estimate limitations of estimated gross profit.",
  },
  salesAttainmentPct: {
    id: "salesAttainmentPct",
    name: "Sales target attainment",
    definition: "Net sales as a percentage of the sales target.",
    formula: "net sales ÷ Σ sales_target_pkr × 100",
    period: "Targets for the months in the period; partial months are pro-rated by days.",
    limitations: "Targets exist by region and month only, so attainment is hidden when a channel or product filter is active.",
  },
  collections: {
    id: "collections",
    name: "Collections",
    definition: "Customer payments received.",
    formula: "Σ amount_paid_pkr for invoices whose payment_date is in the period",
    period: "Payment date in the selected period.",
    limitations: "The dataset records one payment per invoice; real ERP data may have several partial payments per invoice.",
  },
  collectionAttainmentPct: {
    id: "collectionAttainmentPct",
    name: "Collection target attainment",
    definition: "Collections as a percentage of the collection target.",
    formula: "collections ÷ Σ collection_target_pkr × 100",
    period: "Targets for the months in the period; partial months are pro-rated by days.",
    limitations: "Same filter restriction as sales targets.",
  },
  outstanding: {
    id: "outstanding",
    name: "Outstanding receivables",
    definition: "Unpaid invoice balances on the snapshot date.",
    formula: "Σ max(0, invoice_amount − payments made on or before the snapshot date), invoices raised on or before the snapshot date",
    period: "Snapshot at the end of the selected period (or the last date in the data). Includes invoices raised before the period.",
    limitations: "Credit notes and unapplied cash are not modelled.",
  },
  overdue: {
    id: "overdue",
    name: "Overdue balance",
    definition: "Outstanding balance on invoices that are past their due date.",
    formula: "Σ outstanding where due_date < snapshot date",
    period: "Snapshot, as for outstanding receivables.",
    limitations: "Due dates come from payment terms on the invoice; agreed extensions are not recorded.",
  },
  overduePct: {
    id: "overduePct",
    name: "Overdue share",
    definition: "Share of outstanding receivables that is overdue.",
    formula: "overdue ÷ outstanding × 100",
    period: "Snapshot.",
    limitations: "A falling share can mean better collection or simply more recent (not-yet-due) invoicing.",
  },
  invoicePaidRatioPct: {
    id: "invoicePaidRatioPct",
    name: "Invoice paid ratio",
    definition: "Share of invoices raised in the period that were fully paid by the snapshot date.",
    formula: "count(fully paid invoices) ÷ count(invoices raised in period) × 100",
    period: "Invoices raised in the period; payment status at the snapshot date.",
    limitations: "Recent invoices that are not yet due lower the ratio; compare periods of similar age.",
  },
  dso90: {
    id: "dso90",
    name: "Simple DSO (90-day)",
    definition: "Days of sales tied up in receivables.",
    formula: "outstanding ÷ (net sales of the last 90 days ÷ 90)",
    period: "90 days ending at the snapshot date.",
    limitations: "A simple average method; the count-back method is more precise when sales are volatile.",
  },
  topCustomerShare: {
    id: "topCustomerShare",
    name: "Customer concentration",
    definition: "Share of net sales from the largest customers, plus the HHI index.",
    formula: "Top-N share = Σ largest N customer sales ÷ total; HHI = Σ (share %)²",
    period: "Orders in the selected period.",
    limitations: "Treats each customer ID as independent; related accounts under one owner are not grouped.",
  },
  openComplaints: {
    id: "openComplaints",
    name: "Open complaints",
    definition: "Complaints opened on or before the snapshot date and not resolved by it.",
    formula: "count(date_opened ≤ snapshot and (status ≠ Resolved or date_resolved > snapshot))",
    period: "Snapshot; includes complaints opened before the period.",
    limitations: "Depends on complaint status being kept up to date in the source system.",
  },
  avgDiscountPct: {
    id: "avgDiscountPct",
    name: "Average discount",
    definition: "Discount given as a share of list-price value.",
    formula: "1 − net sales ÷ Σ(quantity × list price)",
    period: "Orders in the selected period.",
    limitations: "Weighted by value, so large orders dominate.",
  },
};
