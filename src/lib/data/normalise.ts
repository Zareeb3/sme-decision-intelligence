/**
 * Value normalisation for real-world exports.
 *
 * ERP and spreadsheet exports rarely match a clean schema: SAP writes dates as
 * 30.09.2026 or 20260930, negative numbers as "1,250.00-", statuses as codes.
 * These helpers turn such values into the canonical forms the schemas expect.
 * Anything that cannot be understood is passed through unchanged, so the
 * validator reports it with the original value instead of hiding it.
 */

/** Canonical number string ("-1234.5") or "" for empty. Unparseable input is returned trimmed. */
export function normaliseNumber(raw: string): string {
  let s = (raw ?? "").trim();
  if (s === "") return "";
  let negative = false;
  if (/^\(.*\)$/.test(s)) {
    negative = true;
    s = s.slice(1, -1);
  }
  if (s.endsWith("-")) {
    negative = true; // SAP style trailing minus
    s = s.slice(0, -1);
  }
  if (s.startsWith("-") || s.startsWith("−")) {
    negative = !negative;
    s = s.slice(1);
  }
  s = s.replace(/[\s'’]/g, "").replace(/^[A-Za-z₨$€£]+\.?/, "").replace(/[A-Za-z%]+$/, "");
  const lastDot = s.lastIndexOf(".");
  const lastComma = s.lastIndexOf(",");
  if (lastDot >= 0 && lastComma >= 0) {
    // the later separator is the decimal one
    s = lastComma > lastDot ? s.replace(/\./g, "").replace(",", ".") : s.replace(/,/g, "");
  } else if (lastComma >= 0) {
    // "1,234,567" -> thousands; "12,5" -> decimal comma
    s = /^\d{1,3}(,\d{3})+$/.test(s) ? s.replace(/,/g, "") : s.replace(",", ".");
  } else if (/^\d{1,3}(\.\d{3}){2,}$/.test(s)) {
    s = s.replace(/\./g, ""); // "1.234.567" (European thousands)
  }
  if (!/^\d*\.?\d+$/.test(s)) return (raw ?? "").trim();
  return negative ? `-${s}` : s;
}

export type DateFormat = "ISO" | "YYYYMMDD" | "DMY" | "MDY";

const SEP_DATE = /^(\d{1,2})[./-](\d{1,2})[./-](\d{2,4})$/;

/** Guess the date format used in a column from a sample of values. */
export function detectDateFormat(values: string[]): DateFormat {
  let dmyVotes = 0;
  let mdyVotes = 0;
  let sepSeen = false;
  for (const raw of values) {
    const v = (raw ?? "").trim();
    if (!v) continue;
    if (/^\d{4}-\d{2}-\d{2}/.test(v)) return "ISO";
    if (/^\d{8}$/.test(v)) return "YYYYMMDD";
    const m = SEP_DATE.exec(v);
    if (m) {
      sepSeen = true;
      if (Number(m[1]) > 12) dmyVotes++;
      if (Number(m[2]) > 12) mdyVotes++;
    }
  }
  if (sepSeen && mdyVotes > dmyVotes) return "MDY";
  return sepSeen ? "DMY" : "ISO"; // day-first is the SAP and Pakistan default
}

/** Canonical "YYYY-MM-DD", "" for empty, or the original value if it cannot be read. */
export function normaliseDate(raw: string, fmt: DateFormat): string {
  const v = (raw ?? "").trim();
  if (v === "" || v === "00000000" || v === "00.00.0000") return "";
  const iso = /^(\d{4})-(\d{1,2})-(\d{1,2})/.exec(v);
  if (iso) return `${iso[1]}-${iso[2].padStart(2, "0")}-${iso[3].padStart(2, "0")}`;
  if (/^\d{8}$/.test(v)) return `${v.slice(0, 4)}-${v.slice(4, 6)}-${v.slice(6, 8)}`;
  const m = SEP_DATE.exec(v);
  if (m) {
    let [, a, b, y] = m;
    if (y.length === 2) y = `20${y}`;
    const [d, mo] = fmt === "MDY" ? [b, a] : [a, b];
    return `${y}-${mo.padStart(2, "0")}-${d.padStart(2, "0")}`;
  }
  return v;
}

const MONTHS: Record<string, string> = { jan: "01", feb: "02", mar: "03", apr: "04", may: "05", jun: "06", jul: "07", aug: "08", sep: "09", oct: "10", nov: "11", dec: "12" };

/** "2026-09", "09/2026", "09.2026", "202609", "Sep 2026", "2026-09-01" -> "2026-09" */
export function normaliseMonth(raw: string): string {
  const v = (raw ?? "").trim();
  let m = /^(\d{4})[-/.](\d{1,2})(?:[-/.]\d{1,2})?$/.exec(v);
  if (m) return `${m[1]}-${m[2].padStart(2, "0")}`;
  m = /^(\d{1,2})[-/.](\d{4})$/.exec(v);
  if (m) return `${m[2]}-${m[1].padStart(2, "0")}`;
  m = /^(\d{4})(\d{2})$/.exec(v);
  if (m) return `${m[1]}-${m[2]}`;
  m = /^([A-Za-z]{3})[a-z]*[\s\-/.]+(\d{4})$/.exec(v);
  if (m && MONTHS[m[1].toLowerCase()]) return `${m[2]}-${MONTHS[m[1].toLowerCase()]}`;
  return v;
}

const key = (s: string) => s.trim().toLowerCase().replace(/[^a-z0-9]/g, "");

/** Known spellings and codes for enumerated fields. Matching ignores case, spaces and punctuation. */
export const ENUM_SYNONYMS: Record<string, Record<string, string[]>> = {
  order_status: {
    Delivered: ["delivered", "billed", "invoiced", "complete", "completed", "closed", "posted", "shipped", "f2", "invoice", "sale"],
    Cancelled: ["cancelled", "canceled", "void", "reversed", "x", "s1", "cancellation", "storno"],
    "Credit Note": ["creditnote", "creditmemo", "credit", "return", "returns", "g2", "re", "cn"],
  },
  account_status: {
    Active: ["active", "a", "open", "yes", "y", "1", "true"],
    "On Hold": ["onhold", "hold", "blocked", "block", "creditblock", "suspended", "b"],
    Inactive: ["inactive", "closed", "dormant", "deleted", "no", "n", "0", "false", "archived"],
  },
  invoice_status: {
    Paid: ["paid", "cleared", "settled", "closed"],
    "Partially Paid": ["partiallypaid", "partial", "partpaid"],
    Open: ["open", "unpaid", "outstanding", "due", "overdue"],
  },
  complaint_status: {
    Open: ["open", "new", "notstarted", "outstanding", "osno"],
    "In Progress": ["inprogress", "inprocess", "processing", "underinvestigation", "pending", "assigned", "noprq"],
    Resolved: ["resolved", "completed", "complete", "done", "fixed", "closed", "noco"],
  },
  severity: {
    High: ["high", "critical", "veryhigh", "urgent", "1", "p1", "major"],
    Medium: ["medium", "med", "normal", "2", "p2", "moderate"],
    Low: ["low", "minor", "3", "4", "p3", "p4"],
  },
  payment_type: {
    Payment: ["payment", "receipt", "cash", "bank", "cheque", "check", "dz", "transfer"],
    "Credit Note": ["creditnote", "creditmemo", "credit", "dg", "return"],
  },
};

export function normaliseEnum(field: string, raw: string): string {
  const v = (raw ?? "").trim();
  const table = ENUM_SYNONYMS[field];
  if (!table || v === "") return v;
  const k = key(v);
  for (const [canonical, aliases] of Object.entries(table)) {
    if (key(canonical) === k || aliases.includes(k)) return canonical;
  }
  return v;
}
