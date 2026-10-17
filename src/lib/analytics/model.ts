/**
 * The "model" is the loaded data plus lookup indexes and joins that every
 * analysis needs. Building it once (and caching per bundle) keeps each
 * analysis function simple and fast.
 */
import type { Complaint, Customer, DataBundle, Invoice, Order } from "../data/types";

export interface EnrichedInvoice extends Invoice {
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
}

export interface ProductInfo {
  product_id: string;
  product_name: string;
  product_category: string;
}

export interface Model {
  bundle: DataBundle;
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
    return {
      ...inv,
      region: order?.region ?? cust?.region ?? "Unknown",
      channel: order?.channel ?? cust?.channel ?? "Unknown",
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
    };
  });

  const dates: string[] = [];
  for (const o of bundle.orders) dates.push(o.order_date);
  for (const i of bundle.invoices) {
    dates.push(i.invoice_date);
    if (i.payment_date) dates.push(i.payment_date);
  }
  for (const c of bundle.complaints) dates.push(c.date_opened);
  dates.sort();

  const uniq = (xs: string[]) => [...new Set(xs)].filter(Boolean).sort();
  const model: Model = {
    bundle,
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
