/**
 * Data minimisation before complaint text is sent to an AI provider.
 *
 * Removes contact details and identifiers that triage does not need, and
 * replaces known names (customer, contact person) with neutral placeholders.
 * The original text is kept unchanged in the case; only the outgoing copy is
 * redacted. Pattern-based redaction is a safety net, not a guarantee: free
 * text can contain personal data no pattern recognises.
 */

const PATTERNS: { kind: string; re: RegExp; replacement: string }[] = [
  { kind: "email", re: /[A-Z0-9._%+-]+@[A-Z0-9.-]+\.[A-Z]{2,}/gi, replacement: "[email]" },
  { kind: "national_id", re: /\b\d{5}-\d{7}-\d\b/g, replacement: "[ID number]" },
  { kind: "iban", re: /\b[A-Z]{2}\d{2}[A-Z0-9]{4}\d{10,20}\b/g, replacement: "[bank account]" },
  { kind: "card", re: /\b\d{4}[ -]\d{4}[ -]\d{4}[ -]\d{1,7}\b|\b\d{13,19}\b/g, replacement: "[card or account number]" },
  // Phone numbers start with + (country code) or 0 (local); plain amounts such as 1250000 are left alone.
  { kind: "phone", re: /(?:\+\d{1,3}[\s-]?\(?\d{1,4}\)?|\b0\d{2,4})[\s-]?\d{3,4}[\s-]?\d{3,5}\b/g, replacement: "[phone]" },
];

function escapeRe(s: string) {
  return s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

export interface RedactionResult {
  text: string;
  redactions: Record<string, number>;
}

export function redactForAI(text: string, names: { customer?: string[]; contact?: string[] } = {}): RedactionResult {
  const redactions: Record<string, number> = {};
  let out = text;
  const replaceAll = (kind: string, re: RegExp, replacement: string) => {
    out = out.replace(re, () => {
      redactions[kind] = (redactions[kind] ?? 0) + 1;
      return replacement;
    });
  };
  // Names first (longest first so "Iqra Tile House" wins over "Iqra").
  const nameList = (xs: string[] | undefined) => (xs ?? []).map((n) => n.trim()).filter((n) => n.length >= 3).sort((a, b) => b.length - a.length);
  for (const n of nameList(names.customer)) replaceAll("customer_name", new RegExp(`\\b${escapeRe(n)}\\b`, "gi"), "[customer]");
  for (const n of nameList(names.contact)) replaceAll("contact_name", new RegExp(`\\b${escapeRe(n)}\\b`, "gi"), "[contact person]");
  for (const p of PATTERNS) {
    // Keep business references (order, invoice, complaint numbers) that look like SO000123 / INV-..., which phone patterns do not match.
    replaceAll(p.kind, p.re, p.replacement);
  }
  return { text: out, redactions };
}

/** True when the text appears to contain personal contact data. */
export function containsPersonalData(text: string): boolean {
  return Object.keys(redactForAI(text).redactions).length > 0;
}
