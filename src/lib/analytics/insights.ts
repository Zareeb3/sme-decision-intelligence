/**
 * Deterministic "needs attention" findings for the Overview page.
 * Each finding answers four questions: what happened, why it might matter,
 * what evidence supports it, and what to investigate or do next.
 * Only rules with visible thresholds are used; no AI is involved.
 */
import type { Filters } from "./filters";
import type { Model } from "./model";
import { diagnoseSalesVsCollections } from "./diagnostics";
import { complaintSummary } from "./complaints";
import { productPerformance } from "./products";
import { customerConcentration } from "./concentration";
import { formatDays, formatPKR, formatPct } from "./format";

export interface Insight {
  id: string;
  severity: "high" | "medium" | "info";
  title: string;
  what: string;
  why: string;
  evidence: string[];
  next: string;
  link: string;
}

export function attentionInsights(model: Model, f: Filters): Insight[] {
  const out: Insight[] = [];
  const d = diagnoseSalesVsCollections(model, f);
  const k = d.current;

  if (k.salesAttainmentPct !== null && k.collectionAttainmentPct !== null && k.salesAttainmentPct >= 100 && k.collectionAttainmentPct < 100) {
    const worst = d.regionRows[0];
    out.push({
      id: "sales-collections-gap",
      severity: "high",
      title: "Sales are ahead of target, collections are behind",
      what: `Net sales reached ${formatPct(k.salesAttainmentPct)} of target while collections reached ${formatPct(k.collectionAttainmentPct)}.`,
      why: "Sales that do not convert to cash tie up working capital and raise credit risk.",
      evidence: [
        `Net sales ${formatPKR(k.netSales)} vs target ${formatPKR(k.salesTarget)}`,
        `Collections ${formatPKR(k.collections)} vs target ${formatPKR(k.collectionTarget)}`,
        ...(worst && worst.collectionGap !== null && worst.collectionGap < 0
          ? [`Largest regional gap: ${worst.region}, collections ${formatPct(worst.collectionAttainmentPct)} of target`]
          : []),
      ],
      next: worst ? `Review ${worst.region} receivables and the terms on recent large orders.` : "Review receivables by region.",
      link: "/receivables",
    });
  }

  const movers = d.overdueMovers.filter((m) => m.change > 0).slice(0, 3);
  if (d.current.overdue > d.previous.overdue && movers.length) {
    out.push({
      id: "overdue-growth",
      severity: "high",
      title: "Overdue balance is rising",
      what: `Overdue receivables grew from ${formatPKR(d.previous.overdue)} to ${formatPKR(d.current.overdue)}.`,
      why: "Older balances are harder to recover and may need credit holds or provisions.",
      evidence: movers.map((m) => `${m.customer_name} (${m.region}): ${formatPKR(m.overduePrev)} → ${formatPKR(m.overdueNow)}`),
      next: "Assign collection follow-ups for these accounts and confirm any disputes.",
      link: "/receivables",
    });
  }

  const slow = d.paymentDelayByRegionType.find((p) => (p.changeDays ?? 0) >= 5);
  if (slow) {
    out.push({
      id: "payment-delay",
      severity: "medium",
      title: `${slow.group} customers are paying later`,
      what: `Invoices paid this period were settled ${formatDays(slow.avgDaysAfterDue)} after the due date on average, vs ${formatDays(slow.prevAvgDaysAfterDue)} before.`,
      why: "A change in payment behaviour can be an early signal of liquidity strain or a dispute.",
      evidence: [`${slow.invoicesPaid} invoices paid in the period`],
      next: "Ask the regional team whether terms were extended or issues raised.",
      link: "/receivables",
    });
  }

  const cs = complaintSummary(model, f);
  for (const s of cs.spikes.slice(0, 2)) {
    out.push({
      id: `complaint-spike-${s.product_id}`,
      severity: "high",
      title: `Complaint spike on ${s.product_name}`,
      what: `${s.recentCount} complaints in the last ${s.recentDays} days, mostly ${s.topCategory.toLowerCase()}.`,
      why: "A cluster on one product often points to a batch problem that can affect many customers.",
      evidence: [`Normal rate: about ${s.baselinePerWindow.toFixed(1)} complaints per ${s.recentDays} days`],
      next: "Ask Quality to match complaint orders to production batches.",
      link: "/complaints",
    });
  }

  const pr = productPerformance(model, f);
  const weak = pr.rows.filter((r) => r.flags.some((x) => x.includes("below portfolio"))).sort((a, b) => (a.estGrossMarginPct ?? 0) - (b.estGrossMarginPct ?? 0))[0];
  if (weak && weak.netSales > 0) {
    out.push({
      id: `weak-margin-${weak.key}`,
      severity: "medium",
      title: `Low estimated margin on ${weak.label}`,
      what: `Estimated margin ${formatPct(weak.estGrossMarginPct)} vs ${formatPct(pr.portfolioMarginPct)} for the portfolio.`,
      why: "Selling more of a low-margin line can raise sales while lowering profit.",
      evidence: [`Average discount ${formatPct(weak.avgDiscountPct)}`, `Net sales ${formatPKR(weak.netSales)}`],
      next: "Review discount approvals and cost assumptions for this product.",
      link: "/sales",
    });
  }

  const c = customerConcentration(model, f);
  if (c.top5SharePct >= 30) {
    out.push({
      id: "concentration",
      severity: "info",
      title: "Sales depend on a small group of customers",
      what: `The top 5 customers generated ${formatPct(c.top5SharePct)} of net sales.`,
      why: "Losing or delaying one large account would move the whole result.",
      evidence: c.ranked.slice(0, 3).map((r) => `${r.customer_name}: ${formatPct(r.sharePct)}`),
      next: "Keep account plans and credit reviews current for the largest customers.",
      link: "/customers",
    });
  }

  const rank = { high: 0, medium: 1, info: 2 };
  return out.sort((a, b) => rank[a.severity] - rank[b.severity]);
}
