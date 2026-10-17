/**
 * Column mapping: connect a company's own export columns to the canonical schema.
 *
 * - `autoMap` recognises canonical names, common English headers and SAP
 *   technical field names (VBELN, KUNNR, FKDAT, NETWR, ...).
 * - Users can override any suggestion in the upload screen; the chosen mapping
 *   is remembered for next month's upload.
 * - `toCanonicalRows` renames columns, normalises numbers/dates/codes and fills
 *   documented defaults for optional fields.
 */
import type { DatasetKind } from "./types";
import { detectDateFormat, normaliseDate, normaliseEnum, normaliseMonth, normaliseNumber, type DateFormat } from "./normalise";

export type FieldType = "text" | "number" | "date" | "month" | "enum";

export interface FieldSpec {
  field: string;
  label: string;
  type: FieldType;
  required: boolean;
  /** Enum table name in normalise.ts (defaults to the field name). */
  enumKey?: string;
  help: string;
  /** Alternative header spellings, compared after removing case, spaces and punctuation. */
  synonyms: string[];
}

const f = (field: string, label: string, type: FieldType, required: boolean, help: string, synonyms: string[], enumKey?: string): FieldSpec => ({
  field,
  label,
  type,
  required,
  help,
  synonyms,
  enumKey,
});

export const FIELD_SPECS: Record<DatasetKind, FieldSpec[]> = {
  orders: [
    f("order_id", "Order / billing line ID", "text", true, "Unique per line, e.g. billing document + item", ["orderid", "orderno", "ordernumber", "orderline", "lineid", "billingdocument", "billingdoc", "invoiceitem", "salesdocument", "vbeln", "documentno", "documentnumber"]),
    f("order_date", "Sales date", "date", true, "Billing or order date used to count sales", ["orderdate", "billingdate", "fkdat", "invoicedate", "documentdate", "postingdate", "salesdate", "audat", "date"]),
    f("customer_id", "Customer ID", "text", true, "Must match the customer file", ["customerid", "customer", "customerno", "customernumber", "customercode", "soldto", "soldtoparty", "kunag", "kunnr", "account", "accountid", "debtor"]),
    f("region", "Region", "text", false, "Taken from the customer when missing", ["region", "salesregion", "zone", "territory", "salesdistrict", "bzirk", "salesoffice", "vkbur", "area"]),
    f("channel", "Channel", "text", false, "Taken from the customer when missing", ["channel", "distributionchannel", "vtweg", "saleschannel"]),
    f("product_id", "Product / material ID", "text", true, "", ["productid", "product", "material", "materialno", "materialnumber", "matnr", "sku", "itemcode", "item"]),
    f("product_name", "Product name", "text", false, "Defaults to the product ID", ["productname", "materialdescription", "description", "arktx", "maktx", "itemname", "itemdescription"]),
    f("product_category", "Product category", "text", false, "Defaults to Uncategorised", ["productcategory", "category", "materialgroup", "matkl", "productgroup", "prodh", "productline", "family"]),
    f("quantity_sqm", "Quantity", "number", true, "In the volume unit set in Settings", ["quantitysqm", "quantity", "qty", "fkimg", "billedquantity", "volume", "units", "sqm"]),
    f("list_price_per_sqm", "List price per unit", "number", false, "Derived from net sales and discount when missing", ["listpricepersqm", "listprice", "unitprice", "price", "grossprice", "priceperunit"]),
    f("discount_pct", "Discount %", "number", false, "Defaults to 0", ["discountpct", "discount", "discountpercent", "discpct"]),
    f("net_sales_pkr", "Net sales value", "number", true, "After discounts, before tax", ["netsalespkr", "netsales", "netvalue", "netamount", "netwr", "revenue", "salesvalue", "sales", "amount", "value"]),
    f("est_unit_cost_per_sqm", "Unit cost", "number", false, "Map this or total cost", ["estunitcostpersqm", "unitcost", "costperunit", "standardcost", "stprs"]),
    f("est_cogs_pkr", "Total cost (COGS)", "number", false, "Map this or unit cost; used for margin", ["estcogspkr", "cogs", "costofsales", "costvalue", "totalcost", "wavwr", "vprs", "cost", "estcogs"]),
    f("order_status", "Status", "enum", false, "Delivered, Cancelled or Credit Note; defaults to Delivered", ["orderstatus", "status", "documentstatus", "billingtype", "fkart", "doctype"]),
  ],
  customers: [
    f("customer_id", "Customer ID", "text", true, "", ["customerid", "customer", "customerno", "customernumber", "customercode", "kunnr", "account", "accountid", "debtor"]),
    f("customer_name", "Customer name", "text", true, "", ["customername", "name", "name1", "accountname", "companyname"]),
    f("customer_type", "Customer type", "text", false, "e.g. Distributor, Dealer, Key Account", ["customertype", "customergroup", "kdgrp", "type", "segment", "accountgroup", "ktokd", "class"]),
    f("channel", "Channel", "text", false, "Defaults to the customer type", ["channel", "distributionchannel", "vtweg", "saleschannel"]),
    f("region", "Region", "text", true, "", ["region", "salesregion", "territory", "zone", "salesdistrict", "bzirk", "salesoffice", "vkbur", "regio", "area"]),
    f("city", "City", "text", false, "", ["city", "ort01", "town"]),
    f("payment_terms_days", "Payment terms (days)", "number", false, "Defaults to 30 days", ["paymenttermsdays", "paymentterms", "terms", "termsdays", "creditdays", "paymentdays", "ztermdays", "zterm"]),
    f("credit_limit_pkr", "Credit limit", "number", false, "0 means not recorded", ["creditlimitpkr", "creditlimit", "klimk", "creditline", "limit"]),
    f("onboarding_date", "Customer since", "date", false, "", ["onboardingdate", "createdon", "erdat", "since", "startdate", "customersince"]),
    f("account_status", "Account status", "enum", false, "Active, On Hold or Inactive; defaults to Active", ["accountstatus", "status", "block", "aufsd", "sperr"]),
  ],
  invoices: [
    f("invoice_id", "Invoice ID", "text", true, "", ["invoiceid", "invoice", "invoiceno", "invoicenumber", "belnr", "billingdocument", "documentno", "document", "vbeln"]),
    f("order_id", "Order ID", "text", false, "Leave unmapped when an invoice covers several lines", ["orderid", "salesorder", "aubel", "vgbel", "orderref"]),
    f("customer_id", "Customer ID", "text", true, "", ["customerid", "customer", "customerno", "kunnr", "account", "debtor"]),
    f("invoice_date", "Invoice date", "date", true, "", ["invoicedate", "documentdate", "bldat", "billingdate", "fkdat", "postingdate", "budat", "date"]),
    f("due_date", "Due date", "date", false, "Calculated from customer payment terms when missing", ["duedate", "netduedate", "faedt", "due", "paymentduedate"]),
    f("invoice_amount_pkr", "Invoice amount", "number", true, "", ["invoiceamountpkr", "invoiceamount", "amount", "total", "dmbtr", "wrbtr", "grossamount", "value"]),
    f("amount_paid_pkr", "Amount paid", "number", false, "Ignored when a payments file is loaded", ["amountpaidpkr", "amountpaid", "paid", "paidamount", "received", "receivedamount"]),
    f("payment_date", "Payment date", "date", false, "Ignored when a payments file is loaded", ["paymentdate", "paiddate", "clearingdate", "augdt", "receiptdate"]),
    f("status", "Status", "enum", false, "Derived from the payment when missing", ["status", "paymentstatus", "invoicestatus"], "invoice_status"),
  ],
  payments: [
    f("payment_id", "Payment ID", "text", false, "Generated when missing", ["paymentid", "receipt", "receiptno", "paymentdoc", "augbl", "belnr", "document"]),
    f("invoice_id", "Invoice ID paid", "text", true, "", ["invoiceid", "invoice", "invoiceno", "rebzg", "reference", "invoiceref", "billingdocument"]),
    f("payment_date", "Payment date", "date", true, "", ["paymentdate", "date", "augdt", "budat", "postingdate", "receiptdate", "clearingdate"]),
    f("amount_pkr", "Amount", "number", true, "", ["amountpkr", "amount", "paymentamount", "dmbtr", "wrbtr", "value", "received"]),
    f("payment_type", "Type", "enum", false, "Payment or Credit Note; defaults to Payment", ["paymenttype", "type", "blart", "doctype"]),
  ],
  targets: [
    f("month", "Month", "month", true, "e.g. 2026-09", ["month", "period", "yearmonth", "monat", "date"]),
    f("region", "Region", "text", true, "Same region names as customers", ["region", "salesregion", "territory", "zone", "salesoffice", "area"]),
    f("sales_target_pkr", "Sales target", "number", true, "", ["salestargetpkr", "salestarget", "target", "salesplan", "plan"]),
    f("collection_target_pkr", "Collection target", "number", false, "Defaults to 0 (not set)", ["collectiontargetpkr", "collectiontarget", "collectionplan", "cashtarget", "recoverytarget"]),
  ],
  complaints: [
    f("complaint_id", "Complaint ID", "text", true, "", ["complaintid", "complaint", "notification", "qmnum", "ticket", "caseid", "id"]),
    f("date_opened", "Date opened", "date", true, "", ["dateopened", "createdon", "erdat", "opened", "reporteddate", "qmdat", "date"]),
    f("customer_id", "Customer ID", "text", true, "", ["customerid", "customer", "kunum", "kunnr", "account"]),
    f("order_id", "Order ID", "text", false, "", ["orderid", "order", "salesorder", "vbeln"]),
    f("product_id", "Product ID", "text", false, "", ["productid", "product", "material", "matnr"]),
    f("category", "Category", "text", true, "Defect or issue type", ["category", "defect", "defectcode", "fecod", "complainttype", "issue", "reason", "qmcod"]),
    f("severity", "Severity", "enum", false, "Low, Medium or High; defaults to Medium", ["severity", "priority", "priok"]),
    f("assigned_team", "Owning team", "text", false, "Defaults to Unassigned", ["assignedteam", "team", "department", "responsible", "owner", "workcenter"]),
    f("status", "Status", "enum", false, "Derived from the resolution date when missing", ["status", "complaintstatus", "userstatus", "systemstatus"], "complaint_status"),
    f("date_resolved", "Date resolved", "date", false, "", ["dateresolved", "resolvedon", "closedon", "completiondate", "qmdab"]),
    f("claim_value_pkr", "Claim value", "number", false, "Defaults to 0", ["claimvaluepkr", "claimvalue", "claim", "claimamount", "compensation"]),
  ],
};

export const normaliseHeader = (h: string) => h.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

export type ColumnMapping = Record<string, string | null>;

/** Suggest which source column feeds each canonical field. Each source column is used at most once. */
export function autoMap(kind: DatasetKind, headers: string[]): ColumnMapping {
  const byNorm = new Map<string, string>();
  for (const h of headers) if (!byNorm.has(normaliseHeader(h))) byNorm.set(normaliseHeader(h), h);
  const used = new Set<string>();
  const mapping: ColumnMapping = {};
  const specs = FIELD_SPECS[kind];
  // exact canonical names first, then synonyms in priority order
  for (const s of specs) {
    const h = byNorm.get(normaliseHeader(s.field));
    if (h && !used.has(h)) {
      mapping[s.field] = h;
      used.add(h);
    }
  }
  for (const s of specs) {
    if (mapping[s.field]) continue;
    mapping[s.field] = null;
    for (const syn of s.synonyms) {
      const h = byNorm.get(syn);
      if (h && !used.has(h)) {
        mapping[s.field] = h;
        used.add(h);
        break;
      }
    }
  }
  return mapping;
}

export function missingRequired(kind: DatasetKind, mapping: ColumnMapping): string[] {
  return FIELD_SPECS[kind].filter((s) => s.required && !mapping[s.field]).map((s) => s.field);
}

/** Score how well a file's headers fit each dataset, to sort dropped files automatically. */
export function detectKind(fileName: string, headers: string[]): DatasetKind | null {
  const name = fileName.toLowerCase();
  const byName = (["payments", "invoices", "complaints", "targets", "customers", "orders"] as DatasetKind[]).find((k) => name.includes(k) || name.includes(k.slice(0, -1)));
  if (byName) return byName;
  let best: { kind: DatasetKind; score: number } | null = null;
  for (const kind of Object.keys(FIELD_SPECS) as DatasetKind[]) {
    const m = autoMap(kind, headers);
    const req = FIELD_SPECS[kind].filter((s) => s.required);
    const score = req.filter((s) => m[s.field]).length / req.length;
    if (score === 1 && (!best || req.length > (FIELD_SPECS[best.kind].filter((s) => s.required).length))) best = { kind, score };
  }
  return best?.kind ?? null;
}

export interface CanonicalResult {
  rows: Record<string, string>[];
  /** Notes about defaults and formats applied, shown to the user. */
  notes: string[];
  dateFormats: Record<string, DateFormat>;
}

/**
 * Rename columns per the mapping, normalise values and fill defaults.
 * Rows keep their original order so validation line numbers still match the file.
 */
export function toCanonicalRows(kind: DatasetKind, rawRows: Record<string, string>[], mapping: ColumnMapping): CanonicalResult {
  const specs = FIELD_SPECS[kind];
  const notes: string[] = [];
  const dateFormats: Record<string, DateFormat> = {};
  for (const s of specs) {
    const src = mapping[s.field];
    if (src && s.type === "date") {
      dateFormats[s.field] = detectDateFormat(rawRows.slice(0, 500).map((r) => r[src] ?? ""));
      if (dateFormats[s.field] !== "ISO") notes.push(`${s.label}: dates read as ${dateFormats[s.field] === "DMY" ? "day/month/year" : dateFormats[s.field] === "MDY" ? "month/day/year" : "YYYYMMDD"}.`);
    }
  }

  const rows = rawRows.map((raw, i) => {
    const out: Record<string, string> = {};
    for (const s of specs) {
      const src = mapping[s.field];
      const v = src ? (raw[src] ?? "") : "";
      out[s.field] =
        s.type === "number" ? normaliseNumber(v) : s.type === "date" ? normaliseDate(v, dateFormats[s.field] ?? "ISO") : s.type === "month" ? normaliseMonth(v) : s.type === "enum" ? normaliseEnum(s.enumKey ?? s.field, v) : v.trim();
    }
    applyDefaults(kind, out, i);
    return out;
  });

  const unmapped = specs.filter((s) => !s.required && !mapping[s.field]);
  const defaultedNotes: Record<string, string> = {
    "orders.product_name": "Product names not provided: product IDs are shown instead.",
    "orders.product_category": "Product categories not provided: all products are grouped as Uncategorised.",
    "orders.list_price_per_sqm": "List prices not provided: derived from net sales and discount.",
    "orders.discount_pct": "Discounts not provided: discount analysis will show 0%.",
    "orders.region": "Region not on sales lines: taken from each customer.",
    "orders.channel": "Channel not on sales lines: taken from each customer.",
    "customers.payment_terms_days": "Payment terms not provided: 30 days assumed for due dates.",
    "customers.credit_limit_pkr": "Credit limits not provided: credit-utilisation checks are skipped.",
    "customers.customer_type": "Customer types not provided: all customers are typed as Customer.",
    "invoices.due_date": "Due dates not provided: calculated from each customer's payment terms.",
    "complaints.assigned_team": "Owning team not provided: complaints are Unassigned.",
    "complaints.severity": "Severity not provided: Medium assumed.",
    "targets.collection_target_pkr": "Collection targets not provided: collection attainment is unavailable.",
  };
  for (const s of unmapped) {
    const n = defaultedNotes[`${kind}.${s.field}`];
    if (n) notes.push(n);
  }
  if (kind === "orders" && !mapping.est_cogs_pkr && !mapping.est_unit_cost_per_sqm) {
    notes.push("No cost column mapped: margins will show 0% cost. Map total cost or unit cost for margin analysis.");
  }
  return { rows, notes, dateFormats };
}

const num = (s: string) => (s === "" ? NaN : Number(s));
const fmt = (n: number) => (Number.isFinite(n) ? String(Math.round(n * 100) / 100) : "");

function applyDefaults(kind: DatasetKind, r: Record<string, string>, index: number) {
  switch (kind) {
    case "orders": {
      if (!r.product_name) r.product_name = r.product_id;
      if (!r.product_category) r.product_category = "Uncategorised";
      if (!r.order_status) r.order_status = "Delivered";
      if (!r.discount_pct) r.discount_pct = "0";
      const qty = num(r.quantity_sqm);
      const net = num(r.net_sales_pkr);
      const disc = num(r.discount_pct);
      // ERP exports often carry negative values on credit notes; the canonical form is positive + status
      if (net < 0 && r.order_status === "Delivered") r.order_status = "Credit Note";
      // only credit notes may carry negative signs; elsewhere a negative value stays and fails validation
      if (r.order_status === "Credit Note") {
        for (const k of ["quantity_sqm", "net_sales_pkr", "est_cogs_pkr", "est_unit_cost_per_sqm", "list_price_per_sqm"]) {
          if (r[k]?.startsWith("-")) r[k] = r[k].slice(1);
        }
      }
      const aqty = Math.abs(qty);
      const anet = Math.abs(net);
      if (!r.list_price_per_sqm && aqty > 0 && Number.isFinite(anet)) r.list_price_per_sqm = fmt(anet / aqty / (1 - (Number.isFinite(disc) ? Math.min(disc, 99.99) : 0) / 100));
      if (!r.list_price_per_sqm) r.list_price_per_sqm = "0";
      const unit = num(r.est_unit_cost_per_sqm);
      const cogs = num(r.est_cogs_pkr);
      if (!r.est_cogs_pkr && Number.isFinite(unit)) r.est_cogs_pkr = fmt(unit * aqty);
      if (!r.est_unit_cost_per_sqm && Number.isFinite(cogs)) r.est_unit_cost_per_sqm = aqty > 0 ? fmt(cogs / aqty) : "0";
      if (!r.est_cogs_pkr) r.est_cogs_pkr = "0";
      if (!r.est_unit_cost_per_sqm) r.est_unit_cost_per_sqm = "0";
      break;
    }
    case "customers": {
      if (!r.customer_type) r.customer_type = "Customer";
      if (!r.channel) r.channel = r.customer_type;
      if (!r.payment_terms_days) r.payment_terms_days = "30";
      if (!r.credit_limit_pkr) r.credit_limit_pkr = "0";
      if (!r.account_status) r.account_status = "Active";
      break;
    }
    case "invoices": {
      if (!r.amount_paid_pkr) r.amount_paid_pkr = "0";
      if (!r.status) {
        const amt = num(r.invoice_amount_pkr);
        const paid = num(r.amount_paid_pkr);
        r.status = paid >= amt - 0.5 && amt > 0 ? "Paid" : paid > 0 ? "Partially Paid" : "Open";
      }
      break;
    }
    case "payments": {
      if (!r.payment_id) r.payment_id = `PAY-${index + 1}`;
      if (!r.payment_type) r.payment_type = "Payment";
      if (r.amount_pkr?.startsWith("-")) r.amount_pkr = r.amount_pkr.slice(1);
      break;
    }
    case "targets": {
      if (!r.collection_target_pkr) r.collection_target_pkr = "0";
      break;
    }
    case "complaints": {
      if (!r.severity) r.severity = "Medium";
      if (!r.assigned_team) r.assigned_team = "Unassigned";
      if (!r.status) r.status = r.date_resolved ? "Resolved" : "Open";
      if (!r.claim_value_pkr) r.claim_value_pkr = "0";
      break;
    }
  }
}
