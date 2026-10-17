/**
 * Complaint analysis: what is open, who owns it, how long it takes to resolve,
 * and which products show an unusual rise in complaints.
 */
import { addDays, daysBetween, inRange } from "./dates";
import { asOfDate, filterComplaints, type Filters } from "./filters";
import type { EnrichedComplaint, Model } from "./model";

export interface ComplaintSummary {
  asOf: string;
  openedInPeriod: number;
  openAtAsOf: number;
  openHighSeverity: number;
  openClaimValue: number;
  avgResolutionDays: number | null;
  resolvedInPeriod: number;
  byCategory: { key: string; opened: number; open: number }[];
  byTeam: { key: string; opened: number; open: number; avgOpenAgeDays: number | null }[];
  byProduct: { key: string; label: string; opened: number; open: number }[];
  openList: (EnrichedComplaint & { ageDays: number })[];
  spikes: ComplaintSpike[];
}

export interface ComplaintSpike {
  product_id: string;
  product_name: string;
  recentCount: number;
  recentDays: number;
  baselinePerWindow: number;
  ratio: number | null;
  topCategory: string;
}

const isOpenAt = (c: EnrichedComplaint, asOf: string) =>
  c.date_opened <= asOf && (c.status !== "Resolved" || (c.date_resolved !== "" && c.date_resolved > asOf));

/**
 * Spike rule (transparent, count-based because complaint counts are small):
 * a product is flagged when it has at least 3 complaints in the last 60 days of
 * the period AND at least 3× its average 60-day count over the prior 12 months.
 */
export const SPIKE_RULE = { windowDays: 60, minCount: 3, minRatio: 3 };

export function complaintSummary(model: Model, f: Filters): ComplaintSummary {
  const asOf = asOfDate(model, f);
  const inPeriod = filterComplaints(model, f);
  const allDims = filterComplaints(model, f, { ignoreDates: true });
  const open = allDims.filter((c) => isOpenAt(c, asOf));

  const resolved = allDims.filter((c) => c.date_resolved && inRange(c.date_resolved, f.start, f.end) && c.date_resolved <= asOf);
  const avgResolutionDays = resolved.length
    ? resolved.reduce((s, c) => s + daysBetween(c.date_opened, c.date_resolved), 0) / resolved.length
    : null;

  const group = <K extends string>(rows: EnrichedComplaint[], keyFn: (c: EnrichedComplaint) => K) => {
    const m = new Map<K, EnrichedComplaint[]>();
    for (const r of rows) m.set(keyFn(r), [...(m.get(keyFn(r)) ?? []), r]);
    return m;
  };

  const cats = new Set([...inPeriod, ...open].map((c) => c.category));
  const byCategory = [...cats]
    .map((k) => ({ key: k, opened: inPeriod.filter((c) => c.category === k).length, open: open.filter((c) => c.category === k).length }))
    .sort((a, b) => b.open - a.open || b.opened - a.opened);

  const teams = new Set([...inPeriod, ...open].map((c) => c.assigned_team));
  const byTeam = [...teams]
    .map((k) => {
      const o = open.filter((c) => c.assigned_team === k);
      return {
        key: k,
        opened: inPeriod.filter((c) => c.assigned_team === k).length,
        open: o.length,
        avgOpenAgeDays: o.length ? o.reduce((s, c) => s + daysBetween(c.date_opened, asOf), 0) / o.length : null,
      };
    })
    .sort((a, b) => b.open - a.open);

  const prodGroups = group([...inPeriod, ...open], (c) => c.product_id);
  const byProduct = [...prodGroups.entries()]
    .map(([k, rows]) => ({
      key: k,
      label: rows[0].product_name,
      opened: inPeriod.filter((c) => c.product_id === k).length,
      open: open.filter((c) => c.product_id === k).length,
    }))
    .sort((a, b) => b.opened - a.opened || b.open - a.open);

  // Spikes
  const W = SPIKE_RULE.windowDays;
  const recentStart = addDays(asOf, -(W - 1));
  const baseStart = addDays(recentStart, -365);
  const spikes: ComplaintSpike[] = [];
  const byProd = group(allDims, (c) => c.product_id);
  for (const [pid, rows] of byProd) {
    const recent = rows.filter((c) => inRange(c.date_opened, recentStart, asOf));
    const base = rows.filter((c) => c.date_opened >= baseStart && c.date_opened < recentStart);
    const baselinePerWindow = (base.length / 365) * W;
    const ratio = baselinePerWindow > 0 ? recent.length / baselinePerWindow : null;
    if (recent.length >= SPIKE_RULE.minCount && (ratio === null || ratio >= SPIKE_RULE.minRatio)) {
      const catCounts = group(recent, (c) => c.category);
      const topCategory = [...catCounts.entries()].sort((a, b) => b[1].length - a[1].length)[0][0];
      spikes.push({ product_id: pid, product_name: rows[0].product_name, recentCount: recent.length, recentDays: W, baselinePerWindow, ratio, topCategory });
    }
  }

  return {
    asOf,
    openedInPeriod: inPeriod.length,
    openAtAsOf: open.length,
    openHighSeverity: open.filter((c) => c.severity === "High").length,
    openClaimValue: open.reduce((s, c) => s + c.claim_value_pkr, 0),
    avgResolutionDays,
    resolvedInPeriod: resolved.length,
    byCategory,
    byTeam,
    byProduct,
    openList: open
      .map((c) => ({ ...c, ageDays: daysBetween(c.date_opened, asOf) }))
      .sort((a, b) => (a.severity === b.severity ? b.ageDays - a.ageDays : a.severity === "High" ? -1 : b.severity === "High" ? 1 : 0)),
    spikes: spikes.sort((a, b) => b.recentCount - a.recentCount),
  };
}
