/**
 * Core business record types. These mirror the CSV files in public/sample-data.
 * All monetary values are Pakistani rupees (PKR). All dates are ISO "YYYY-MM-DD".
 */

export type CustomerType = "Distributor" | "Dealer" | "Key Account" | "Institutional";
export type AccountStatus = "Active" | "On Hold" | "Inactive";
export type OrderStatus = "Delivered" | "Cancelled";
export type InvoiceStatus = "Paid" | "Partially Paid" | "Open";
export type ComplaintStatus = "Open" | "In Progress" | "Resolved";
export type Severity = "Low" | "Medium" | "High";

export interface Customer {
  customer_id: string;
  customer_name: string;
  customer_type: CustomerType;
  channel: string;
  region: string;
  city: string;
  payment_terms_days: number;
  credit_limit_pkr: number;
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
  order_id: string;
  customer_id: string;
  invoice_date: string;
  due_date: string;
  invoice_amount_pkr: number;
  amount_paid_pkr: number;
  /** Empty string when nothing has been paid as of the data snapshot. */
  payment_date: string;
  status: InvoiceStatus;
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
  targets: Target[];
  complaints: Complaint[];
  /** Where the data came from, shown in the UI. */
  source: "sample" | "upload" | "mixed";
}

export type DatasetKind = "customers" | "orders" | "invoices" | "targets" | "complaints";
export const DATASET_KINDS: DatasetKind[] = ["orders", "customers", "invoices", "targets", "complaints"];
