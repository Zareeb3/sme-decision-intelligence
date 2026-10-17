/**
 * Zod schemas: the single source of truth for what a valid row looks like.
 * Each CSV row is parsed with these schemas; failures become readable
 * validation messages in the Data page instead of silent NaNs in a KPI.
 */
import { z } from "zod";
import { isValidIsoDate } from "../analytics/dates";
import type { DatasetKind } from "./types";

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
  customer_type: oneOf("customer_type", ["Distributor", "Dealer", "Key Account", "Institutional"]),
  channel: requiredText("channel"),
  region: requiredText("region"),
  city: z.string().trim(),
  payment_terms_days: nonNegativeNumber("payment_terms_days"),
  credit_limit_pkr: nonNegativeNumber("credit_limit_pkr"),
  onboarding_date: isoDate("onboarding_date"),
  account_status: oneOf("account_status", ["Active", "On Hold", "Inactive"]),
});

export const orderSchema = z.object({
  order_id: requiredText("order_id"),
  order_date: isoDate("order_date"),
  customer_id: requiredText("customer_id"),
  region: requiredText("region"),
  channel: requiredText("channel"),
  product_id: requiredText("product_id"),
  product_name: requiredText("product_name"),
  product_category: requiredText("product_category"),
  quantity_sqm: nonNegativeNumber("quantity_sqm"),
  list_price_per_sqm: nonNegativeNumber("list_price_per_sqm"),
  discount_pct: nonNegativeNumber("discount_pct").refine((n) => n <= 100, "discount_pct must be between 0 and 100"),
  net_sales_pkr: nonNegativeNumber("net_sales_pkr"),
  est_unit_cost_per_sqm: nonNegativeNumber("est_unit_cost_per_sqm"),
  est_cogs_pkr: nonNegativeNumber("est_cogs_pkr"),
  order_status: oneOf("order_status", ["Delivered", "Cancelled"]),
});

export const invoiceSchema = z
  .object({
    invoice_id: requiredText("invoice_id"),
    order_id: requiredText("order_id"),
    customer_id: requiredText("customer_id"),
    invoice_date: isoDate("invoice_date"),
    due_date: isoDate("due_date"),
    invoice_amount_pkr: nonNegativeNumber("invoice_amount_pkr"),
    amount_paid_pkr: nonNegativeNumber("amount_paid_pkr"),
    payment_date: optionalIsoDate("payment_date"),
    status: oneOf("status", ["Paid", "Partially Paid", "Open"]),
  })
  .refine((r) => r.due_date >= r.invoice_date, { message: "due_date cannot be before invoice_date", path: ["due_date"] })
  .refine((r) => r.amount_paid_pkr === 0 || r.payment_date !== "", {
    message: "payment_date is required when amount_paid_pkr is above zero",
    path: ["payment_date"],
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
  requiredColumns: string[];
  description: string;
}

const columnsOf = (schema: z.ZodTypeAny): string[] => {
  // unwrap ZodEffects (from .refine on the object) to reach the shape
  let s: z.ZodTypeAny = schema;
  while (s instanceof z.ZodEffects) s = s._def.schema;
  return Object.keys((s as z.AnyZodObject).shape);
};

export const DATASET_SPECS: Record<DatasetKind, DatasetSpec> = {
  orders: {
    kind: "orders",
    label: "Orders & sales",
    fileName: "orders.csv",
    schema: orderSchema,
    key: ["order_id"],
    requiredColumns: columnsOf(orderSchema),
    description: "One row per order line: date, customer, product, volume, price, discount, net sales and estimated cost.",
  },
  customers: {
    kind: "customers",
    label: "Customer accounts",
    fileName: "customers.csv",
    schema: customerSchema,
    key: ["customer_id"],
    requiredColumns: columnsOf(customerSchema),
    description: "Customer master: type, channel, region, payment terms, credit limit and account status.",
  },
  invoices: {
    kind: "invoices",
    label: "Invoices & payments",
    fileName: "invoices.csv",
    schema: invoiceSchema,
    key: ["invoice_id"],
    requiredColumns: columnsOf(invoiceSchema),
    description: "One invoice per delivered order with due date, amount paid and payment date.",
  },
  targets: {
    kind: "targets",
    label: "Monthly targets",
    fileName: "targets.csv",
    schema: targetSchema,
    key: ["month", "region"],
    requiredColumns: columnsOf(targetSchema),
    description: "Sales and collection targets by month and region.",
  },
  complaints: {
    kind: "complaints",
    label: "Customer complaints",
    fileName: "complaints.csv",
    schema: complaintSchema,
    key: ["complaint_id"],
    requiredColumns: columnsOf(complaintSchema),
    description: "Complaint log: category, severity, owning team, status and claim value.",
  },
};
