/**
 * Privacy option: replace customer names with neutral aliases ("Account A")
 * before the evidence packet leaves the browser, and restore the real names in
 * the answer when it comes back. The AI provider never sees who the customers are.
 * Aliases use letters, not digits, so they never interfere with the grounding check.
 */
import type { AnalystResponse, EvidencePacket } from "./types";

function alias(i: number): string {
  let s = "";
  let n = i;
  do {
    s = String.fromCharCode(65 + (n % 26)) + s;
    n = Math.floor(n / 26) - 1;
  } while (n >= 0);
  return `Account ${s}`;
}

const escape = (s: string) => s.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

export interface AnonymisedPacket {
  packet: EvidencePacket;
  /** alias -> real name */
  aliases: Map<string, string>;
}

export function anonymisePacket(packet: EvidencePacket, customerNames: string[]): AnonymisedPacket {
  const names = [...new Set(customerNames.filter((n) => n && n.trim().length >= 3))].sort((a, b) => b.length - a.length);
  const blob = [packet.question, ...packet.items.map((i) => `${i.label} ${i.display}`)].join("\n");
  const present = names.filter((n) => blob.includes(n));
  const aliases = new Map<string, string>();
  const forward = new Map<string, string>();
  present.forEach((n, i) => {
    const a = alias(i);
    aliases.set(a, n);
    forward.set(n, a);
  });
  if (present.length === 0) return { packet, aliases };
  const re = new RegExp(present.map(escape).join("|"), "g");
  const swap = (s: string) => s.replace(re, (m) => forward.get(m) ?? m);
  return {
    packet: {
      ...packet,
      question: swap(packet.question),
      items: packet.items.map((i) => ({ ...i, label: swap(i.label), display: swap(i.display) })),
    },
    aliases,
  };
}

export function deanonymiseText(text: string, aliases: Map<string, string>): string {
  if (aliases.size === 0) return text;
  // longest aliases first so "Account AB" is not partially replaced by "Account A"
  const keys = [...aliases.keys()].sort((a, b) => b.length - a.length);
  const re = new RegExp(`\\b(${keys.map(escape).join("|")})\\b`, "g");
  return text.replace(re, (m) => aliases.get(m) ?? m);
}

export function deanonymiseResponse(r: AnalystResponse, aliases: Map<string, string>): AnalystResponse {
  if (aliases.size === 0) return r;
  const t = (s: string) => deanonymiseText(s, aliases);
  return {
    summary: t(r.summary),
    facts: r.facts.map((f) => ({ ...f, statement: t(f.statement) })),
    hypotheses: r.hypotheses.map((h) => ({ ...h, statement: t(h.statement), how_to_verify: t(h.how_to_verify) })),
    recommendations: r.recommendations.map((x) => ({ ...x, action: t(x.action), rationale: t(x.rationale) })),
    uncertainties: r.uncertainties.map(t),
    follow_up_questions: r.follow_up_questions.map(t),
  };
}

export function deanonymisePacket(p: EvidencePacket, aliases: Map<string, string>): EvidencePacket {
  if (aliases.size === 0) return p;
  return { ...p, question: deanonymiseText(p.question, aliases), items: p.items.map((i) => ({ ...i, label: deanonymiseText(i.label, aliases), display: deanonymiseText(i.display, aliases) })) };
}
