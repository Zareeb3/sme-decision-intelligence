/**
 * Core business record types (the app's "canonical schema").
 *
 * Any source (sample data, CSV uploads, an SAP pipeline) is converted into
 * these shapes before analysis. Monetary columns keep the historical `_pkr`
 * suffix for compatibility, but hold amounts in the company's reporting
 * currency, which is set in Settings. All dates are ISO "YYYY-MM-DD".
 */

export type AccountStatus = "Active" | "On Hold" | "Inactive";
/** "Credit Note" lines reduce sales (returns, price corrections). Values are entered as positive amounts. */
export type OrderStatus = "Delivered" | "Cancelled" | "Credit Note";
export type InvoiceStatus = "Paid" | "Partially Paid" | "Open";
export type ComplaintStatus = "Open" | "In Progress" | "Resolved";
export type Severity = "Low" | "Medium" | "High";
export type PaymentType = "Payment" | "Credit Note";

export interface Customer {
  customer_id: string;
  customer_name: string;
  /** Free text, e.g. Distributor, Dealer, Key Account, Retailer. */
  customer_type: string;
  channel: string;
  region: string;
  city: string;
  payment_terms_days: number;
  /** 0 means "not recorded"; credit utilisation is then not calculated. */
  credit_limit_pkr: number;
  /** May be empty when unknown. */
  onboarding_date: string;
  account_status: AccountStatus;
}

export interface Order {
  order_id: string;
  order_date: string;
  customer_id: string;
  region: string;
  channel: string;
  product_id: string;
  product_name: string;
  product_category: string;
  quantity_sqm: number;
  list_price_per_sqm: number;
  discount_pct: number;
  net_sales_pkr: number;
  est_unit_cost_per_sqm: number;
  est_cogs_pkr: number;
  order_status: OrderStatus;
}

export interface Invoice {
  invoice_id: string;
  /** Empty when an invoice covers several order lines (typical for ERP data). */
  order_id: string;
  customer_id: string;
  invoice_date: string;
  due_date: string;
  invoice_amount_pkr: number;
  /** Used only when no payments file is loaded. */
  amount_paid_pkr: number;
  /** Used only when no payments file is loaded. Empty when unpaid. */
  payment_date: string;
  status: InvoiceStatus;
}

/** One cash receipt or credit applied to an invoice. Several per invoice are allowed. */
export interface Payment {
  payment_id: string;
  invoice_id: string;
  payment_date: string;
  amount_pkr: number;
  /** Credit notes reduce the balance but are not counted as cash collections. */
  payment_type: PaymentType;
}

export interface Target {
  /** "YYYY-MM" */
  month: string;
  region: string;
  sales_target_pkr: number;
  collection_target_pkr: number;
}

export interface Complaint {
  complaint_id: string;
  date_opened: string;
  customer_id: string;
  order_id: string;
  product_id: string;
  category: string;
  severity: Severity;
  assigned_team: string;
  status: ComplaintStatus;
  date_resolved: string;
  claim_value_pkr: number;
}

export interface DataBundle {
  customers: Customer[];
  orders: Order[];
  invoices: Invoice[];
  payments: Payment[];
  targets: Target[];
  complaints: Complaint[];
  /** Where the data came from, shown in the UI. */
  source: "sample" | "upload" | "pipeline" | "mixed";
}

export type DatasetKind = "customers" | "orders" | "invoices" | "payments" | "targets" | "complaints";
export const DATASET_KINDS: DatasetKind[] = ["orders", "customers", "invoices", "payments", "targets", "complaints"];
