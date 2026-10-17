/**
 * Date helpers. We keep dates as ISO strings ("YYYY-MM-DD") everywhere because
 * ISO strings sort and compare correctly as plain strings, which avoids
 * time-zone bugs that come from JavaScript Date objects.
 */

const ISO_DATE = /^(\d{4})-(\d{2})-(\d{2})$/;

/** True when `s` is a real calendar date in YYYY-MM-DD form (rejects 2025-02-30). */
export function isValidIsoDate(s: string): boolean {
  const m = ISO_DATE.exec(s);
  if (!m) return false;
  const [y, mo, d] = [Number(m[1]), Number(m[2]), Number(m[3])];
  if (mo < 1 || mo > 12 || d < 1) return false;
  return d <= daysInMonth(y, mo);
}

export function daysInMonth(year: number, month: number): number {
  return new Date(Date.UTC(year, month, 0)).getUTCDate();
}

function toUtc(s: string): number {
  const [y, m, d] = s.split("-").map(Number);
  return Date.UTC(y, m - 1, d);
}

function fromUtc(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

/** Whole days from `a` to `b` (positive when b is later). */
export function daysBetween(a: string, b: string): number {
  return Math.round((toUtc(b) - toUtc(a)) / 86_400_000);
}

export function addDays(s: string, n: number): string {
  return fromUtc(toUtc(s) + n * 86_400_000);
}

/** "2026-09-14" -> "2026-09" */
export function monthKey(s: string): string {
  return s.slice(0, 7);
}

/** "2026-09-14" -> "2026-Q3" */
export function quarterKey(s: string): string {
  const m = Number(s.slice(5, 7));
  return `${s.slice(0, 4)}-Q${Math.ceil(m / 3)}`;
}

/**
 * Quarter label honouring the fiscal year. With a January start this is the
 * calendar quarter ("2026-Q3"). Otherwise fiscal years are named by the
 * calendar year they end in: with a July start, Sep 2026 is "FY2027-Q1".
 */
export function fiscalQuarterKey(s: string, fiscalStartMonth = 1): string {
  if (fiscalStartMonth === 1) return quarterKey(s);
  const y = Number(s.slice(0, 4));
  const m = Number(s.slice(5, 7));
  const fy = m >= fiscalStartMonth ? y + 1 : y;
  const q = Math.floor(((m - fiscalStartMonth + 12) % 12) / 3) + 1;
  return `FY${fy}-Q${q}`;
}

/** First and last day of a fiscal year (named by its ending calendar year). */
export function fiscalYearRange(fy: number, fiscalStartMonth = 1): { start: string; end: string } {
  if (fiscalStartMonth === 1) return { start: `${fy}-01-01`, end: `${fy}-12-31` };
  const startMonth = `${fy - 1}-${String(fiscalStartMonth).padStart(2, "0")}`;
  return { start: monthStart(startMonth), end: monthEnd(addMonths(startMonth, 11)) };
}

/** Fiscal year (by ending year) that contains a date. */
export function fiscalYearOf(s: string, fiscalStartMonth = 1): number {
  const y = Number(s.slice(0, 4));
  return fiscalStartMonth === 1 || Number(s.slice(5, 7)) < fiscalStartMonth ? y : y + 1;
}

export function monthStart(month: string): string {
  return `${month}-01`;
}

export function monthEnd(month: string): string {
  const [y, m] = month.split("-").map(Number);
  return `${month}-${String(daysInMonth(y, m)).padStart(2, "0")}`;
}

/** Inclusive list of month keys between two dates. */
export function monthsBetween(start: string, end: string): string[] {
  const out: string[] = [];
  let [y, m] = monthKey(start).split("-").map(Number);
  const [ey, em] = monthKey(end).split("-").map(Number);
  while (y < ey || (y === ey && m <= em)) {
    out.push(`${y}-${String(m).padStart(2, "0")}`);
    m += 1;
    if (m > 12) {
      m = 1;
      y += 1;
    }
  }
  return out;
}

export function addMonths(month: string, n: number): string {
  const [y, m] = month.split("-").map(Number);
  const idx = y * 12 + (m - 1) + n;
  return `${Math.floor(idx / 12)}-${String((idx % 12) + 1).padStart(2, "0")}`;
}

/** True when `d` falls within [start, end] inclusive. */
export function inRange(d: string, start: string, end: string): boolean {
  return d >= start && d <= end;
}

/**
 * The period of equal length immediately before [start, end].
 * When the period is whole calendar months, the previous period is also whole
 * months (e.g. Jul–Sep -> Apr–Jun), which is what managers expect.
 */
export function previousPeriod(start: string, end: string): { start: string; end: string } {
  const wholeMonths = start.endsWith("-01") && end === monthEnd(monthKey(end));
  if (wholeMonths) {
    const n = monthsBetween(start, end).length;
    const ps = addMonths(monthKey(start), -n);
    const pe = addMonths(monthKey(start), -1);
    return { start: monthStart(ps), end: monthEnd(pe) };
  }
  const len = daysBetween(start, end) + 1;
  return { start: addDays(start, -len), end: addDays(start, -1) };
}
