/**
 * The "model" is the loaded data plus lookup indexes and joins that every
 * analysis needs. Building it once (and caching per bundle) keeps each
 * analysis function simple and fast.
 */
import type { Complaint, Customer, DataBundle, Invoice, Order, PaymentType } from "../data/types";

export interface InvoicePayment {
  date: string;
  amount: number;
  type: PaymentType;
}

export interface EnrichedInvoice extends Invoice {
  /** Payments and credits applied to this invoice, oldest first. */
  payments: InvoicePayment[];
  region: string;
  channel: string;
  product_id: string;
  product_category: string;
  customer_type: string;
  /** False when the invoice's order_id is not present in orders.csv. */
  linkedToOrder: boolean;
}

export interface EnrichedComplaint extends Complaint {
  region: string;
  channel: string;
  product_category: string;
  product_name: string;
  /** Set when the complaint has a case in the complaint register (see lib/complaints/merge.ts). */
  caseId?: string;
  caseStatus?: string;
  /** Four-level triage priority (confirmed by a person, otherwise the latest suggestion). */
  priority?: "Low" | "Medium" | "High" | "Critical";
  priorityConfirmed?: boolean;
  escalated?: boolean;
  /** "import": from the complaints dataset; "register": entered in the app. */
  origin?: "import" | "register";
  customer_type?: string;
}

export interface ProductInfo {
  product_id: string;
  product_name: string;
  product_category: string;
}

export interface Model {
  bundle: DataBundle;
  /**
   * Sales lines used by every analysis: delivered lines as recorded plus credit
   * notes with negative quantity, value and cost. Cancelled lines are excluded.
   */
  orders: Order[];
  /** True when payments come from a separate payments file (several per invoice). */
  hasPaymentsFile: boolean;
  customersById: Map<string, Customer>;
  ordersById: Map<string, Order>;
  productsById: Map<string, ProductInfo>;
  invoices: EnrichedInvoice[];
  complaints: EnrichedComplaint[];
  /** Earliest and latest business dates in the data. */
  minDate: string;
  maxDate: string;
  regions: string[];
  channels: string[];
  categories: string[];
}

const cache = new WeakMap<DataBundle, Model>();

export function buildModel(bundle: DataBundle): Model {
  const hit = cache.get(bundle);
  if (hit) return hit;

  const customersById = new Map(bundle.customers.map((c) => [c.customer_id, c]));
  const orders: Order[] = [];
  for (const o of bundle.orders) {
    if (o.order_status === "Delivered") orders.push(o);
    else if (o.order_status === "Credit Note")
      orders.push({ ...o, quantity_sqm: -o.quantity_sqm, net_sales_pkr: -o.net_sales_pkr, est_cogs_pkr: -o.est_cogs_pkr });
  }

  const hasPaymentsFile = bundle.payments.length > 0;
  const paymentsByInvoice = new Map<string, InvoicePayment[]>();
  for (const p of bundle.payments) {
    const list = paymentsByInvoice.get(p.invoice_id) ?? [];
    list.push({ date: p.payment_date, amount: p.amount_pkr, type: p.payment_type });
    paymentsByInvoice.set(p.invoice_id, list);
  }
  for (const list of paymentsByInvoice.values()) list.sort((a, b) => (a.date < b.date ? -1 : a.date > b.date ? 1 : 0));
  const ordersById = new Map(bundle.orders.map((o) => [o.order_id, o]));
  const productsById = new Map<string, ProductInfo>();
  for (const o of bundle.orders) {
    if (!productsById.has(o.product_id)) {
      productsById.set(o.product_id, {
        product_id: o.product_id,
        product_name: o.product_name,
        product_category: o.product_category,
      });
    }
  }

  const invoices: EnrichedInvoice[] = bundle.invoices.map((inv) => {
    const order = ordersById.get(inv.order_id);
    const cust = customersById.get(inv.customer_id);
    const payments: InvoicePayment[] = hasPaymentsFile
      ? (paymentsByInvoice.get(inv.invoice_id) ?? [])
      : inv.payment_date && inv.amount_paid_pkr > 0
        ? [{ date: inv.payment_date, amount: inv.amount_paid_pkr, type: "Payment" }]
        : [];
    return {
      ...inv,
      payments,
      region: order?.region ?? cust?.region ?? "Unassigned",
      channel: order?.channel ?? cust?.channel ?? "Unassigned",
      product_id: order?.product_id ?? "",
      product_category: order?.product_category ?? "",
      customer_type: cust?.customer_type ?? "Unknown",
      linkedToOrder: Boolean(order),
    };
  });

  const complaints: EnrichedComplaint[] = bundle.complaints.map((c) => {
    const cust = customersById.get(c.customer_id);
    const prod = productsById.get(c.product_id);
    return {
      ...c,
      region: cust?.region ?? "Unknown",
      channel: cust?.channel ?? "Unknown",
      product_category: prod?.product_category ?? "",
      product_name: prod?.product_name ?? c.product_id,
      origin: "import",
      customer_type: cust?.customer_type ?? "Unknown",
    };
  });

  const dates: string[] = [];
  for (const o of bundle.orders) dates.push(o.order_date);
  for (const i of invoices) {
    dates.push(i.invoice_date);
    for (const p of i.payments) dates.push(p.date);
  }
  for (const c of bundle.complaints) dates.push(c.date_opened);
  dates.sort();

  const uniq = (xs: string[]) => [...new Set(xs)].filter(Boolean).sort();
  const model: Model = {
    bundle,
    orders,
    hasPaymentsFile,
    customersById,
    ordersById,
    productsById,
    invoices,
    complaints,
    minDate: dates[0] ?? "",
    maxDate: dates[dates.length - 1] ?? "",
    regions: uniq(bundle.orders.map((o) => o.region).concat(bundle.customers.map((c) => c.region))),
    channels: uniq(bundle.orders.map((o) => o.channel).concat(bundle.customers.map((c) => c.channel))),
    categories: uniq(bundle.orders.map((o) => o.product_category)),
  };
  cache.set(bundle, model);
  return model;
}
