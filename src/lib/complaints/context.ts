/**
 * Links a complaint case to the company's records and prepares what triage needs.
 *
 * Linking uses only exact identifiers (customer ID, order ID, invoice ID,
 * product ID). Nothing is matched on names or guessed. When a reference is not
 * found, the case says so instead of linking the wrong record.
 */
import { addDays, daysBetween, inRange } from "../analytics/dates";
import { allTimeFilters } from "../analytics/filters";
import type { EnrichedComplaint, EnrichedInvoice, Model } from "../analytics/model";
import { outstandingAsOf, daysPastDue, paidAsOf } from "../analytics/receivables";
import { complaintSummary } from "../analytics/complaints";
import { customerProfiles, type CustomerProfile } from "../analytics/customers";
import { getRules, type BusinessRules } from "../settings";
import type { RuleContext } from "./rules";
import { redactForAI } from "./redact";
import type { ReferenceCheck } from "./workflow";
import { buildTaxonomy, DEFAULT_CATEGORIES, type Taxonomy } from "./taxonomy";
import type { TriageRequest } from "./llm";
import type { ComplaintCase } from "./types";

export function referenceChecker(model: Model): ReferenceCheck {
  const invoiceIds = new Set(model.invoices.map((i) => i.invoice_id.toLowerCase()));
  const ordersLower = new Map([...model.ordersById.values()].map((o) => [o.order_id.toLowerCase(), o]));
  return {
    customerExists: (id) => model.customersById.has(id),
    orderBelongsTo: (orderId) => {
      const o = model.ordersById.get(orderId) ?? ordersLower.get(orderId.toLowerCase());
      return o ? { exists: true, customerId: o.customer_id, productId: o.product_id } : { exists: false };
    },
    productExists: (id) => model.productsById.has(id),
    invoiceExists: (id) => invoiceIds.has(id.toLowerCase()),
  };
}

/** Rank customers by net sales over the 12 months to `asOf` (1 = largest). */
export function salesRanks(model: Model, asOf: string): Map<string, number> {
  const start = addDays(asOf, -364);
  const totals = new Map<string, number>();
  for (const o of model.orders) if (inRange(o.order_date, start, asOf)) totals.set(o.customer_id, (totals.get(o.customer_id) ?? 0) + o.net_sales_pkr);
  const ranked = [...totals.entries()].filter(([, v]) => v > 0).sort((a, b) => b[1] - a[1]);
  return new Map(ranked.map(([id], i) => [id, i + 1]));
}

const complaintKey = (c: ComplaintCase) => c.linkedComplaintId ?? c.id;

/** Other complaints (imported and register) for rule evaluation, relative to the case's received date. */
export function buildRuleContext(model: Model, c: ComplaintCase, rules: BusinessRules["complaints"] = getRules().complaints): RuleContext {
  const self = complaintKey(c);
  const others = model.complaints.filter((x) => x.complaint_id !== self && x.date_opened <= c.receivedDate);
  const repeatStart = addDays(c.receivedDate, -rules.repeatWindowDays);
  const sysStart = addDays(c.receivedDate, -rules.systemicWindowDays);
  const fromCustomer = c.customerId ? others.filter((x) => x.customer_id === c.customerId && x.date_opened >= repeatStart) : [];
  const product = c.productId ? model.productsById.get(c.productId) : undefined;
  const sameProduct = c.productId ? others.filter((x) => x.product_id === c.productId && x.date_opened >= sysStart) : [];
  let spikeCategory: string | null = null;
  if (c.productId) {
    const s = complaintSummary(model, { ...allTimeFilters(model), end: c.receivedDate < model.maxDate ? c.receivedDate : model.maxDate }, rules);
    spikeCategory = s.spikes.find((sp) => sp.product_id === c.productId)?.topCategory ?? null;
  }
  const orderId = c.orderRef ?? (c.linkedComplaintId ? model.complaints.find((x) => x.complaint_id === c.linkedComplaintId)?.order_id : null) ?? null;
  const cust = c.customerId ? model.customersById.get(c.customerId) : undefined;
  return {
    text: c.originalText,
    claimValue: c.claimValue,
    customerType: cust?.customer_type ?? null,
    customerSalesRank: c.customerId ? (salesRanks(model, c.receivedDate < model.maxDate ? c.receivedDate : model.maxDate).get(c.customerId) ?? null) : null,
    priorCustomerComplaints: fromCustomer.length,
    priorSameCategory: (cat) => fromCustomer.filter((x) => x.category.toLowerCase() === cat.toLowerCase() && !(orderId && x.order_id === orderId)).length,
    productCategoryCount: (cat) => sameProduct.filter((x) => x.category.toLowerCase() === cat.toLowerCase()).length,
    productSpike: (cat) => spikeCategory !== null && spikeCategory.toLowerCase() === cat.toLowerCase(),
    productName: product?.product_name ?? null,
    productRelated: (cat) => ["Quality", "Production"].includes(DEFAULT_CATEGORIES.find((d) => d.name.toLowerCase() === cat.toLowerCase())?.department ?? "Quality"),
  };
}

/** Everything the triage endpoint receives. Names and contact details are removed here, in the browser. */
export function buildTriageRequest(model: Model, c: ComplaintCase, tax: Taxonomy, rules: BusinessRules["complaints"] = getRules().complaints): { request: TriageRequest; redactions: Record<string, number> } {
  const cust = c.customerId ? model.customersById.get(c.customerId) : undefined;
  const product = c.productId ? model.productsById.get(c.productId) : undefined;
  const names = { customer: [cust?.customer_name, c.customerNameEntered].filter(Boolean) as string[], contact: [c.contactName].filter(Boolean) };
  const red = redactForAI(c.originalText, names);
  const sup = redactForAI(c.supportingInfo, names);
  const yearStart = addDays(c.receivedDate, -365);
  const prior = c.customerId ? model.complaints.filter((x) => x.customer_id === c.customerId && x.complaint_id !== complaintKey(c) && x.date_opened >= yearStart && x.date_opened <= c.receivedDate).length : 0;
  const rank = c.customerId ? salesRanks(model, c.receivedDate < model.maxDate ? c.receivedDate : model.maxDate).get(c.customerId) : undefined;
  return {
    request: {
      text: red.text,
      channel: c.channel,
      receivedDate: c.receivedDate,
      product: product ? { name: product.product_name, category: product.product_category } : null,
      customer: cust ? { type: cust.customer_type, region: cust.region, complaintsLast12Months: prior, isImportantAccount: (rank ?? 999) <= 10 || /key account|institution/i.test(cust.customer_type) } : null,
      references: { order: Boolean(c.orderRef || c.linkedComplaintId), invoice: Boolean(c.invoiceRef) },
      supportingInfo: sup.text,
      categories: tax.categories.map((x) => ({ name: x.name, description: x.description })),
      departments: tax.departments,
      responseHours: { Critical: rules.slaCriticalHours, High: rules.slaHighHours, Medium: rules.slaMediumHours, Low: rules.slaLowHours },
    },
    redactions: Object.fromEntries(Object.entries({ ...red.redactions }).map(([k, v]) => [k, v + (sup.redactions[k] ?? 0)])),
  };
}

export interface LinkedRecords {
  customer: (Pick<CustomerProfile, "customer_id" | "customer_name" | "customer_type" | "region" | "channel" | "account_status" | "healthScore" | "healthBand" | "salesTrendPct" | "sales90" | "outstanding" | "overdue"> & { salesRank: number | null }) | null;
  order: { order_id: string; order_date: string; product_name: string; quantity: number; net_sales: number; status: string } | null;
  invoices: { invoice_id: string; invoice_date: string; due_date: string; amount: number; paid: number; outstanding: number; daysPastDue: number }[];
  product: { product_id: string; product_name: string; product_category: string } | null;
  sourceComplaint: EnrichedComplaint | null;
  relatedCustomerComplaints: EnrichedComplaint[];
  relatedProductComplaints: EnrichedComplaint[];
  notes: string[];
}

export function linkedRecords(model: Model, c: ComplaintCase, sourceModel?: Model): LinkedRecords {
  const asOf = model.maxDate;
  const notes: string[] = [];
  let customer: LinkedRecords["customer"] = null;
  if (c.customerId && model.customersById.has(c.customerId)) {
    const p = customerProfiles(model, { ...allTimeFilters(model), start: addDays(asOf, -89), end: asOf }).find((x) => x.customer_id === c.customerId);
    if (p) customer = { customer_id: p.customer_id, customer_name: p.customer_name, customer_type: p.customer_type, region: p.region, channel: p.channel, account_status: p.account_status, healthScore: p.healthScore, healthBand: p.healthBand, salesTrendPct: p.salesTrendPct, sales90: p.sales90, outstanding: p.outstanding, overdue: p.overdue, salesRank: salesRanks(model, asOf).get(p.customer_id) ?? null };
  } else if (c.customerId) notes.push(`Customer ${c.customerId} is not in the customer master.`);
  else notes.push(`Customer "${c.customerNameEntered}" was entered by name only; it is not linked to sales or receivables.`);

  const orderId = c.orderRef ?? (c.linkedComplaintId ? model.complaints.find((x) => x.complaint_id === c.linkedComplaintId)?.order_id : undefined);
  const o = orderId ? model.ordersById.get(orderId) : undefined;
  if (orderId && !o) notes.push(`Order ${orderId} was not found in the sales data.`);
  const order = o ? { order_id: o.order_id, order_date: o.order_date, product_name: o.product_name, quantity: o.quantity_sqm, net_sales: o.net_sales_pkr, status: o.order_status } : null;

  const invs: EnrichedInvoice[] = model.invoices.filter((i) => (o && i.order_id === o.order_id) || (c.invoiceRef && i.invoice_id.toLowerCase() === c.invoiceRef.toLowerCase()));
  const invoices = invs.map((i) => ({ invoice_id: i.invoice_id, invoice_date: i.invoice_date, due_date: i.due_date, amount: i.invoice_amount_pkr, paid: paidAsOf(i, asOf), outstanding: outstandingAsOf(i, asOf), daysPastDue: Math.max(0, daysPastDue(i, asOf)) }));

  const pid = c.productId ?? o?.product_id;
  const prod = pid ? model.productsById.get(pid) : undefined;
  const product = prod ? { product_id: prod.product_id, product_name: prod.product_name, product_category: prod.product_category } : null;

  const self = complaintKey(c);
  const src = sourceModel ?? model;
  const sourceComplaint = c.linkedComplaintId ? (src.complaints.find((x) => x.complaint_id === c.linkedComplaintId) ?? null) : null;
  const yearAgo = addDays(c.receivedDate, -365);
  const relatedCustomerComplaints = c.customerId ? model.complaints.filter((x) => x.customer_id === c.customerId && x.complaint_id !== self && x.date_opened >= yearAgo).sort((a, b) => (a.date_opened < b.date_opened ? 1 : -1)) : [];
  const relatedProductComplaints = pid
    ? model.complaints.filter((x) => x.product_id === pid && x.complaint_id !== self && Math.abs(daysBetween(x.date_opened, c.receivedDate)) <= 90).sort((a, b) => (a.date_opened < b.date_opened ? 1 : -1))
    : [];
  return { customer, order, invoices, product, sourceComplaint, relatedCustomerComplaints, relatedProductComplaints, notes };
}

/** Categories and departments for this company: defaults plus those found in its complaint data. */
export function taxonomyForModel(model: Model): Taxonomy {
  const imported = model.complaints.filter((c) => c.origin !== "register");
  return buildTaxonomy([...new Set(imported.map((c) => c.category))], [...new Set(imported.map((c) => c.assigned_team))]);
}
