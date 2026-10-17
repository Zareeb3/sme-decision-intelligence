/**
 * Display formatting. Amounts are shown in the company's currency with
 * K / M / B suffixes so they read naturally for local and international audiences.
 */
import { getSettings } from "../settings";

/** ISO code of the reporting currency, e.g. "PKR". */
export function currencyCode(): string {
  return getSettings().currency;
}

export function formatMoney(n: number | null | undefined, opts: { precise?: boolean } = {}): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  const c = currencyCode();
  const sign = n < 0 ? "−" : "";
  const a = Math.abs(n);
  if (opts.precise) return `${sign}${c} ${Math.round(a).toLocaleString("en-US")}`;
  if (a >= 1e9) return `${sign}${c} ${(a / 1e9).toFixed(2)}B`;
  if (a >= 1e6) return `${sign}${c} ${(a / 1e6).toFixed(1)}M`;
  if (a >= 1e3) return `${sign}${c} ${(a / 1e3).toFixed(0)}K`;
  return `${sign}${c} ${a.toFixed(0)}`;
}

/** Kept for compatibility: formats in the active currency (PKR by default). */
export const formatPKR = formatMoney;

/** Compact axis labels for charts: 950M, 1.2B */
export function formatCompact(n: number): string {
  const a = Math.abs(n);
  const sign = n < 0 ? "−" : "";
  if (a >= 1e9) return `${sign}${(a / 1e9).toFixed(1)}B`;
  if (a >= 1e6) return `${sign}${(a / 1e6).toFixed(0)}M`;
  if (a >= 1e3) return `${sign}${(a / 1e3).toFixed(0)}K`;
  return `${sign}${a.toFixed(0)}`;
}

export function formatPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n.toFixed(digits)}%`;
}

export function formatSignedPct(n: number | null | undefined, digits = 1): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${n > 0 ? "+" : n < 0 ? "−" : ""}${Math.abs(n).toFixed(digits)}%`;
}

export function formatNumber(n: number | null | undefined, digits = 0): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return n.toLocaleString("en-US", { maximumFractionDigits: digits, minimumFractionDigits: digits });
}

export function formatDays(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return "—";
  return `${Math.round(n)} days`;
}

const MONTHS = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];

/** "2026-09" -> "Sep 2026"; "2026-09-30" -> "30 Sep 2026" */
export function formatMonth(m: string): string {
  const [y, mo] = m.split("-");
  return `${MONTHS[Number(mo) - 1]} ${y}`;
}

export function formatDate(d: string): string {
  if (!d) return "—";
  const [y, m, day] = d.split("-");
  return `${Number(day)} ${MONTHS[Number(m) - 1]} ${y}`;
}

export function formatPeriod(start: string, end: string): string {
  return `${formatDate(start)} – ${formatDate(end)}`;
}
