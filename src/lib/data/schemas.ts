/**
 * Zod schemas: the single source of truth for what a valid row looks like.
 * Each CSV row is parsed with these schemas; failures become readable
 * validation messages in the Data page instead of silent NaNs in a KPI.
 */
import { z } from "zod";
import { isValidIsoDate } from "../analytics/dates";
import type { DatasetKind } from "./types";
import { FIELD_SPECS } from "./mapping";

const requiredText = (label: string) =>
  z.string({ required_error: `${label} is required` }).trim().min(1, `${label} is required`);

const isoDate = (label: string) =>
  requiredText(label).refine(isValidIsoDate, { message: `${label} must be a real date in YYYY-MM-DD format` });

/** Empty string allowed (e.g. not yet paid / not yet resolved). */
const optionalIsoDate = (label: string) =>
  z
    .string()
    .trim()
    .refine((s) => s === "" || isValidIsoDate(s), { message: `${label} must be empty or a real date in YYYY-MM-DD format` });

const nonNegativeNumber = (label: string) =>
  z.preprocess(
    (v) => (typeof v === "string" ? (v.trim() === "" ? undefined : Number(v.replace(/,/g, ""))) : v),
    z
      .number({ required_error: `${label} is required`, invalid_type_error: `${label} must be a number` })
      .refine(Number.isFinite, `${label} must be a number`)
      .refine((n) => n >= 0, `${label} cannot be negative`),
  );

const oneOf = <T extends string>(label: string, values: readonly [T, ...T[]]) =>
  z.preprocess(
    (v) => (typeof v === "string" ? v.trim() : v),
    z.enum(values, { errorMap: () => ({ message: `${label} must be one of: ${values.join(", ")}` }) }),
  );

export const customerSchema = z.object({
  customer_id: requiredText("customer_id"),
  customer_name: requiredText("customer_name"),
  customer_type: requiredText("customer_type"),
  channel: requiredText("channel"),
  region: requiredText("region"),
  city: z.string().trim(),
  payment_terms_days: nonNegativeNumber("payment_terms_days"),
  credit_limit_pkr: nonNegativeNumber("credit_limit_pkr"),
  onboarding_date: optionalIsoDate("onboarding_date"),
  account_status: oneOf("account_status", ["Active", "On Hold", "Inactive"]),
});

export const orderSchema = z.object({
  order_id: requiredText("order_id"),
  order_date: isoDate("order_date"),
  customer_id: requiredText("customer_id"),
  // filled from the customer master when blank
  region: z.string().trim(),
  channel: z.string().trim(),
  product_id: requiredText("product_id"),
  product_name: requiredText("product_name"),
  product_category: requiredText("product_category"),
  quantity_sqm: nonNegativeNumber("quantity_sqm"),
  list_price_per_sqm: nonNegativeNumber("list_price_per_sqm"),
  discount_pct: nonNegativeNumber("discount_pct").refine((n) => n <= 100, "discount_pct must be between 0 and 100"),
  net_sales_pkr: nonNegativeNumber("net_sales_pkr"),
  est_unit_cost_per_sqm: nonNegativeNumber("est_unit_cost_per_sqm"),
  est_cogs_pkr: nonNegativeNumber("est_cogs_pkr"),
  order_status: oneOf("order_status", ["Delivered", "Cancelled", "Credit Note"]),
});

export const invoiceSchema = z
  .object({
    invoice_id: requiredText("invoice_id"),
    order_id: z.string().trim(),
    customer_id: requiredText("customer_id"),
    invoice_date: isoDate("invoice_date"),
    due_date: optionalIsoDate("due_date"),
    invoice_amount_pkr: nonNegativeNumber("invoice_amount_pkr"),
    amount_paid_pkr: nonNegativeNumber("amount_paid_pkr"),
    payment_date: optionalIsoDate("payment_date"),
    status: oneOf("status", ["Paid", "Partially Paid", "Open"]),
  })
  .refine((r) => r.due_date === "" || r.due_date >= r.invoice_date, { message: "due_date cannot be before invoice_date", path: ["due_date"] })
  .refine((r) => r.amount_paid_pkr === 0 || r.payment_date !== "", {
    message: "payment_date is required when amount_paid_pkr is above zero",
    path: ["payment_date"],
  });

export const paymentSchema = z.object({
  payment_id: requiredText("payment_id"),
  invoice_id: requiredText("invoice_id"),
  payment_date: isoDate("payment_date"),
  amount_pkr: nonNegativeNumber("amount_pkr"),
  payment_type: oneOf("payment_type", ["Payment", "Credit Note"]),
});

export const targetSchema = z.object({
  month: requiredText("month").refine((s) => /^\d{4}-(0[1-9]|1[0-2])$/.test(s), "month must be in YYYY-MM format"),
  region: requiredText("region"),
  sales_target_pkr: nonNegativeNumber("sales_target_pkr"),
  collection_target_pkr: nonNegativeNumber("collection_target_pkr"),
});

export const complaintSchema = z.object({
  complaint_id: requiredText("complaint_id"),
  date_opened: isoDate("date_opened"),
  customer_id: requiredText("customer_id"),
  order_id: z.string().trim(),
  product_id: z.string().trim(),
  category: requiredText("category"),
  severity: oneOf("severity", ["Low", "Medium", "High"]),
  assigned_team: requiredText("assigned_team"),
  status: oneOf("status", ["Open", "In Progress", "Resolved"]),
  date_resolved: optionalIsoDate("date_resolved"),
  claim_value_pkr: nonNegativeNumber("claim_value_pkr"),
});

export interface DatasetSpec {
  kind: DatasetKind;
  label: string;
  fileName: string;
  schema: z.ZodTypeAny;
  /** Column that must be unique, or a list of columns forming a unique key. */
  key: string[];
  /** Fields that must be present (mapped) in the file. */
  requiredColumns: string[];
  /** Every canonical field, in file order. */
  allColumns: string[];
  /** Optional datasets can be skipped entirely. */
  optional: boolean;
  description: string;
}

const req = (k: DatasetKind) => FIELD_SPECS[k].filter((x) => x.required).map((x) => x.field);
const all = (k: DatasetKind) => FIELD_SPECS[k].map((x) => x.field);

export const DATASET_SPECS: Record<DatasetKind, DatasetSpec> = {
  orders: {
    kind: "orders",
    label: "Sales lines",
    fileName: "orders.csv",
    schema: orderSchema,
    key: ["order_id"],
    requiredColumns: req("orders"),
    allColumns: all("orders"),
    optional: false,
    description: "One row per order or billing line: date, customer, product, quantity, net value and cost.",
  },
  customers: {
    kind: "customers",
    label: "Customers",
    fileName: "customers.csv",
    schema: customerSchema,
    key: ["customer_id"],
    requiredColumns: req("customers"),
    allColumns: all("customers"),
    optional: false,
    description: "Customer master: type, channel, region, payment terms, credit limit and status.",
  },
  invoices: {
    kind: "invoices",
    label: "Invoices",
    fileName: "invoices.csv",
    schema: invoiceSchema,
    key: ["invoice_id"],
    requiredColumns: req("invoices"),
    allColumns: all("invoices"),
    optional: false,
    description: "Customer invoices (open and paid) with amounts and due dates.",
  },
  payments: {
    kind: "payments",
    label: "Payments received",
    fileName: "payments.csv",
    schema: paymentSchema,
    key: ["payment_id"],
    requiredColumns: req("payments"),
    allColumns: all("payments"),
    optional: true,
    description: "Optional. Each receipt or credit note applied to an invoice; supports several payments per invoice.",
  },
  targets: {
    kind: "targets",
    label: "Monthly targets",
    fileName: "targets.csv",
    schema: targetSchema,
    key: ["month", "region"],
    requiredColumns: req("targets"),
    allColumns: all("targets"),
    optional: true,
    description: "Optional. Sales and collection targets by month and region.",
  },
  complaints: {
    kind: "complaints",
    label: "Complaints",
    fileName: "complaints.csv",
    schema: complaintSchema,
    key: ["complaint_id"],
    requiredColumns: req("complaints"),
    allColumns: all("complaints"),
    optional: true,
    description: "Optional. Quality and service complaints with severity, team and status.",
  },
};
