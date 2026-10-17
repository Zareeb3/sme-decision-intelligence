/**
 * Grounding check: does the explanation only use numbers from the evidence?
 *
 * For every statement we:
 *  1. extract each number (with its unit: PKR amounts, M/B suffixes, %, days),
 *  2. look for a matching value in the evidence packet, allowing only for
 *     display rounding (e.g. "PKR 928.6M" matches 928,567,583),
 *  3. check that cited evidence IDs exist, and that facts cite at least one,
 *  4. warn when a "fact" uses causal language ("because", "caused by", ...),
 *     since the data shows association, not cause.
 *
 * This is a safety net, not a proof of correctness: a sentence can use a
 * correct number in a misleading way. The UI shows the report next to every
 * answer so a manager can see what was and was not verified.
 */
import type { AnalystResponse, EvidencePacket, GroundingIssue, GroundingReport } from "./types";

interface Num {
  raw: string;
  value: number;
  /** Allowed absolute rounding error implied by how the number was written. */
  tolerance: number;
  kind: "money" | "plain";
}

const MULT: Record<string, number> = { b: 1e9, bn: 1e9, billion: 1e9, m: 1e6, mn: 1e6, million: 1e6, k: 1e3, thousand: 1e3 };

const NUMBER_RE =
  /(PKR|Rs\.?)?\s?([−-])?(\d{1,3}(?:,\d{3})+|\d+)(?:\.(\d+))?(?:\s?(billion|million|thousand|bn|mn|B|M|K)(?![a-z]))?\s?(%|percent|pts|percentage points|days?)?/gi;

/** Remove tokens that contain digits but are not quantities. */
function stripNonQuantities(text: string): string {
  return text
    .replace(/\b\d{4}-\d{2}-\d{2}\b/g, " ")
    .replace(/\b\d{4}-\d{2}\b/g, " ")
    .replace(/\b\d{4}-Q[1-4]\b/gi, " ")
    .replace(/\bQ[1-4]\s?\d{4}\b/gi, " ")
    .replace(/\b(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\.?\s+\d{4}\b/gi, " ")
    .replace(/\b\d{1,2}\s+(Jan|Feb|Mar|Apr|May|Jun|Jul|Aug|Sep|Oct|Nov|Dec)[a-z]*\b/gi, " ")
    .replace(/\b[A-Z]{1,4}\d{2,}\b/g, " ") // IDs: C0006, SO000123, INV000001, CMP00012, P013, E12
    .replace(/\bE\d+\b/g, " ")
    .replace(/\b\d+\s?x\s?\d+\b/gi, " ") // tile sizes 60x120
    .replace(/\b(19|20)\d{2}\b/g, " "); // bare years
}

export function extractNumbers(text: string): Num[] {
  const out: Num[] = [];
  const cleaned = stripNonQuantities(text);
  for (const m of cleaned.matchAll(NUMBER_RE)) {
    const [raw, currency, minus, intPart, decPart, suffix, unit] = m;
    if (!intPart) continue;
    const base = Number(intPart.replace(/,/g, "") + (decPart ? `.${decPart}` : ""));
    const mult = suffix ? MULT[suffix.toLowerCase()] : 1;
    const decimals = decPart ? decPart.length : 0;
    const sign = minus ? -1 : 1;
    const money = Boolean(currency) || Boolean(suffix);
    out.push({
      raw: raw.trim(),
      value: sign * base * mult,
      tolerance: (0.5 * Math.pow(10, -decimals) + 1e-9) * mult,
      kind: money ? "money" : "plain",
    });
    void unit;
  }
  return out;
}

/** All numbers the explanation may legitimately use. */
function allowedNumbers(packet: EvidencePacket): { money: number[]; plain: number[] } {
  const money: number[] = [];
  const plain: number[] = [];
  for (const item of packet.items) {
    if (item.value !== null) {
      if (item.unit === "PKR") money.push(item.value);
      else plain.push(item.value);
      // magnitudes are also fine (e.g. "fell by 5.2%" for a −5.2% change)
      if (item.value < 0) (item.unit === "PKR" ? money : plain).push(-item.value);
    }
    for (const n of extractNumbers(`${item.display} ${item.label}`)) (n.kind === "money" ? money : plain).push(n.value, Math.abs(n.value));
  }
  for (const n of extractNumbers(packet.question)) (n.kind === "money" ? money : plain).push(n.value);
  for (const l of packet.limitations) for (const n of extractNumbers(l)) plain.push(n.value);
  return { money, plain };
}

function isAllowed(n: Num, allowed: { money: number[]; plain: number[] }): boolean {
  const abs = Math.abs(n.value);
  if (n.kind === "plain" && Number.isInteger(n.value) && abs <= 12) return true; // "top 5", "3 months", "2 accounts"
  const pool = n.kind === "money" ? [...allowed.money, ...allowed.plain.filter((v) => Math.abs(v) >= 1000)] : allowed.plain;
  return pool.some((v) => Math.abs(v - n.value) <= n.tolerance || Math.abs(Math.abs(v) - abs) <= n.tolerance);
}

const CAUSAL = /\b(because|caused|causes|due to|led to|leads to|resulted in|results in|driven by|as a result of)\b/i;

export function checkGrounding(response: AnalystResponse, packet: EvidencePacket): GroundingReport {
  const ids = new Set(packet.items.map((i) => i.id));
  const allowed = allowedNumbers(packet);
  const issues: GroundingIssue[] = [];
  const unverified = new Set<string>();
  let checked = 0;

  const checkText = (text: string, section: GroundingIssue["section"], index: number) => {
    for (const n of extractNumbers(text)) {
      checked++;
      if (!isAllowed(n, allowed)) {
        unverified.add(n.raw);
        issues.push({ severity: "error", section, index, message: `Number "${n.raw}" does not match any evidence value.` });
      }
    }
  };
  const checkIds = (cited: string[], section: GroundingIssue["section"], index: number, required: boolean) => {
    const bad = cited.filter((c) => !ids.has(c));
    if (bad.length) issues.push({ severity: "error", section, index, message: `Cites unknown evidence ID(s): ${bad.join(", ")}.` });
    if (required && cited.length === 0) issues.push({ severity: "error", section, index, message: "A fact must cite at least one evidence ID." });
  };

  checkText(response.summary, "summary", 0);
  response.facts.forEach((f, i) => {
    checkText(f.statement, "facts", i);
    checkIds(f.evidence_ids, "facts", i, true);
    if (CAUSAL.test(f.statement)) {
      issues.push({ severity: "warning", section: "facts", index: i, message: "Causal wording in a fact; causes belong in hypotheses." });
    }
  });
  response.hypotheses.forEach((h, i) => {
    checkText(`${h.statement} ${h.how_to_verify}`, "hypotheses", i);
    checkIds(h.evidence_ids, "hypotheses", i, false);
  });
  response.recommendations.forEach((r, i) => {
    checkText(`${r.action} ${r.rationale}`, "recommendations", i);
    checkIds(r.evidence_ids, "recommendations", i, false);
  });

  return {
    grounded: !issues.some((i) => i.severity === "error"),
    numbersChecked: checked,
    unverifiedNumbers: [...unverified],
    issues,
  };
}
