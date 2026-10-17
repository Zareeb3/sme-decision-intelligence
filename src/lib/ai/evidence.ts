/**
 * Evidence packets: the verified numbers the AI explanation is allowed to use.
 *
 * Each analysis adds labelled items with a stable `key` (used by the demo
 * explainer and the evaluation set) and a short ID ("E1", "E2", ...) that the
 * explanation must cite. Values are computed here, by the analytics engine,
 * never by the language model.
 */
import { computeKpis } from "../analytics/kpis";
import { describeFilters, type Filters } from "../analytics/filters";
import type { Model } from "../analytics/model";
import { diagnoseSalesVsCollections } from "../analytics/diagnostics";
import { breakdown } from "../analytics/breakdowns";
import { customerConcentration } from "../analytics/concentration";
import { receivablesByCustomer, receivablesSnapshot } from "../analytics/receivables";
import { accountsNeedingAttention, customerProfiles } from "../analytics/customers";
import { productPerformance } from "../analytics/products";
import { detectSalesAnomalies } from "../analytics/anomalies";
import { collectionUpliftScenario } from "../analytics/scenarios";
import { complaintSummary } from "../analytics/complaints";
import { backtestAndForecast, METHOD_LABELS } from "../analytics/forecast";
import { formatDays, formatMonth, formatNumber, formatPKR, formatPct, formatPeriod, formatSignedPct } from "../analytics/format";
import { checkBundleConsistency } from "../data/validate";
import type { AnalysisId, EvidenceItem, EvidencePacket } from "./types";
import { getSettings } from "../settings";
import { complaintInsights, registerStats } from "../complaints/insights";
import { currentPriority } from "../complaints/merge";
import { isOpenStatus } from "../complaints/workflow";
import { severityToPriority } from "../complaints/taxonomy";
import type { ComplaintCase } from "../complaints/types";

type Unit = EvidenceItem["unit"];

class EvidenceBuilder {
  items: EvidenceItem[] = [];
  private current: AnalysisId = "next_steps";
  constructor(private readonly max = 90) {}

  section(a: AnalysisId) {
    this.current = a;
  }

  add(key: string, label: string, value: number | null, unit: Unit, display?: string): string | null {
    if (this.items.length >= this.max) return null;
    const existing = this.items.find((i) => i.key === key);
    if (existing) return existing.id;
    const id = `E${this.items.length + 1}`;
    this.items.push({ id, key, analysis: this.current, label, value, unit, display: display ?? defaultDisplay(value, unit) });
    return id;
  }

  text(key: string, label: string, display: string) {
    return this.add(key, label, null, "text", display);
  }
}

function defaultDisplay(v: number | null, unit: Unit): string {
  if (v === null) return "not available";
  switch (unit) {
    case "PKR":
      return formatPKR(v);
    case "%":
      return formatPct(v);
    case "pts":
      return `${v.toFixed(1)} pts`;
    case "days":
      return formatDays(v);
    case "score":
      return `${Math.round(v)} / 100`;
    default:
      return formatNumber(v);
  }
}

export const SAMPLE_LIMITATION = "The dataset is synthetic (a fictional tile business); results demonstrate the method, not real market behaviour.";

export const STANDING_LIMITATIONS = [
  "Costs are estimated standard costs, so gross profit and margin are estimates.",
  "Targets exist by region and month only.",
];

export function buildEvidence(
  model: Model,
  f: Filters,
  question: string,
  analyses: AnalysisId[],
  opts: { scenarioPct?: number; cases?: ComplaintCase[]; now?: Date } = {},
): EvidencePacket {
  const b = new EvidenceBuilder();
  const k = computeKpis(model, f);
  const limitations = [...(model.bundle.source === "sample" ? [SAMPLE_LIMITATION] : []), ...STANDING_LIMITATIONS];
  if (!model.hasPaymentsFile) limitations.push("Each invoice carries a single payment record; load a payments file to track several partial payments.");

  for (const a of analyses) {
    b.section(a);
    switch (a) {
      case "sales_vs_collections": {
        const d = diagnoseSalesVsCollections(model, f);
        b.add("kpi.netSales", "Net sales in the period", k.netSales, "PKR");
        b.add("kpi.salesTarget", "Sales target for the period", k.salesTarget, "PKR");
        b.add("kpi.salesAttainmentPct", "Sales target attainment", k.salesAttainmentPct, "%");
        b.add("kpi.collections", "Collections received in the period", k.collections, "PKR");
        b.add("kpi.collectionTarget", "Collection target for the period", k.collectionTarget, "PKR");
        b.add("kpi.collectionAttainmentPct", "Collection target attainment", k.collectionAttainmentPct, "%");
        b.add("diag.salesChangePct", `Net sales change vs previous period (${formatPeriod(d.previousPeriod.start, d.previousPeriod.end)})`, d.salesChangePct, "%", formatSignedPct(d.salesChangePct));
        b.add("diag.collectionsChangePct", "Collections change vs previous period", d.collectionsChangePct, "%", formatSignedPct(d.collectionsChangePct));
        b.add("diag.collectionsToSalesPct", "Collections as % of net sales, this period", d.collectionsToSalesPct, "%");
        b.add("diag.prevCollectionsToSalesPct", "Collections as % of net sales, previous period", d.prevCollectionsToSalesPct, "%");
        b.add("kpi.overdue", `Overdue balance on ${k.period.asOf}`, k.overdue, "PKR");
        b.add("diag.prevOverdue", `Overdue balance on ${d.previous.period.asOf}`, d.previous.overdue, "PKR");
        for (const r of d.regionRows.slice(0, 4)) {
          b.add(
            `diag.region.${r.region}`,
            `${r.region}: sales and collections vs target`,
            r.collectionGap,
            "PKR",
            `sales ${formatPKR(r.netSales)} (${formatPct(r.salesAttainmentPct)} of target); collections ${formatPKR(r.collections)} (${formatPct(r.collectionAttainmentPct)} of target); collection gap ${formatPKR(r.collectionGap)}`,
          );
        }
        for (const p of d.paymentDelayByRegionType.filter((x) => (x.changeDays ?? 0) > 2).slice(0, 3)) {
          b.add(
            `diag.delay.${p.group}`,
            `${p.group}: average days paid after due date (invoices paid in period)`,
            p.avgDaysAfterDue,
            "days",
            `${formatDays(p.avgDaysAfterDue)} vs ${formatDays(p.prevAvgDaysAfterDue)} in the previous period (${p.invoicesPaid} invoices)`,
          );
        }
        for (const m of d.overdueMovers.filter((x) => x.change > 0).slice(0, 3)) {
          b.add(
            `diag.mover.${m.customer_id}`,
            `${m.customer_name} (${m.customer_type}, ${m.region}): overdue balance change`,
            m.change,
            "PKR",
            `overdue rose from ${formatPKR(m.overduePrev)} to ${formatPKR(m.overdueNow)}`,
          );
        }
        for (const r of d.salesDriversByChannel.slice(0, 3)) {
          b.add(`drivers.channel.${r.key}`, `${r.label} channel: net sales and change`, r.netSales, "PKR", `${formatPKR(r.netSales)} (${formatSignedPct(r.changePct)} vs previous period)`);
        }
        limitations.push("Average payment delay only covers invoices that were paid; slow invoices that remain unpaid show up in the overdue balance instead.");
        break;
      }
      case "performance_drivers": {
        b.add("kpi.netSales", "Net sales in the period", k.netSales, "PKR");
        b.add("kpi.salesAttainmentPct", "Sales target attainment", k.salesAttainmentPct, "%");
        for (const dim of ["region", "channel"] as const) {
          for (const r of breakdown(model, f, dim).slice(0, 5)) {
            b.add(
              `drivers.${dim}.${r.key}`,
              `${r.label} (${dim}): net sales, share and change`,
              r.netSales,
              "PKR",
              `${formatPKR(r.netSales)}, ${formatPct(r.sharePct)} of total, ${formatSignedPct(r.changePct)} vs previous period, estimated margin ${formatPct(r.estGrossMarginPct)}`,
            );
          }
        }
        const cust = breakdown(model, f, "customer")
          .map((r) => ({ ...r, delta: r.netSales - r.prevNetSales }))
          .sort((x, y) => Math.abs(y.delta) - Math.abs(x.delta))
          .slice(0, 4);
        for (const r of cust) {
          b.add(`drivers.customer.${r.key}`, `${r.label}: change in net sales vs previous period`, r.delta, "PKR", `${formatPKR(r.prevNetSales)} → ${formatPKR(r.netSales)}`);
        }
        limitations.push("Contribution to change shows where sales moved, not why they moved.");
        break;
      }
      case "customer_concentration": {
        const c = customerConcentration(model, f);
        b.add("conc.customers", "Customers with sales in the period", c.customers, "count");
        b.add("conc.top1", "Share of net sales from the largest customer", c.top1SharePct, "%");
        b.add("conc.top5", "Share of net sales from the top 5 customers", c.top5SharePct, "%");
        b.add("conc.top10", "Share of net sales from the top 10 customers", c.top10SharePct, "%");
        b.add("conc.for80", "Number of customers making up 80% of net sales", c.customersFor80Pct, "count");
        b.add("conc.hhi", "HHI concentration index (0–10,000; under 1,500 usually read as unconcentrated)", c.hhi, "count", formatNumber(c.hhi));
        for (const r of c.ranked.slice(0, 5)) {
          b.add(`conc.cust.${r.customer_id}`, `${r.customer_name} (${r.customer_type}, ${r.region})`, r.sharePct, "%", `${formatPKR(r.netSales)}, ${formatPct(r.sharePct)} of net sales`);
        }
        limitations.push("Related accounts under common ownership are not grouped, which can understate concentration.");
        break;
      }
      case "receivables_risk": {
        const snap = receivablesSnapshot(model, f);
        b.add("kpi.outstanding", `Outstanding receivables on ${snap.asOf}`, snap.outstanding, "PKR");
        b.add("kpi.overdue", `Overdue balance on ${snap.asOf}`, snap.overdue, "PKR");
        b.add("kpi.overduePct", "Overdue share of outstanding", snap.overduePct, "%");
        b.add("kpi.over90", "Balance more than 90 days past due", snap.over90, "PKR");
        b.add("kpi.dso90", "Simple DSO (90-day)", k.dso90, "days");
        for (const a2 of snap.aging) b.add(`aging.${a2.bucket}`, `Aging bucket: ${a2.bucket}`, a2.amount, "PKR", `${formatPKR(a2.amount)} across ${a2.invoices} invoices`);
        for (const r of receivablesByCustomer(model, f).slice(0, 5)) {
          b.add(
            `recv.cust.${r.customer_id}`,
            `${r.customer_name} (${r.customer_type}, ${r.region}): overdue balance`,
            r.overdue,
            "PKR",
            `${formatPKR(r.overdue)} overdue of ${formatPKR(r.outstanding)} outstanding; oldest ${r.oldestDaysPastDue} days past due; credit use ${formatPct(r.creditUtilizationPct, 0)}`,
          );
        }
        break;
      }
      case "distributor_attention": {
        const profiles = customerProfiles(model, f);
        const partner = getSettings().partnerType;
        const partnerMatch = (t: string) => t.toLowerCase() === partner.toLowerCase();
        const hasPartners = profiles.some((p) => partnerMatch(p.customer_type));
        const partnerLabel = hasPartners ? `${partner}s` : "Customers";
        const dist = hasPartners ? profiles.filter((p) => partnerMatch(p.customer_type)) : profiles;
        const bands = ["Healthy", "Watch", "Needs attention", "Insufficient data"] as const;
        for (const band of bands) b.add(`health.dist.${band}`, `${partnerLabel} in band "${band}"`, dist.filter((p) => p.healthBand === band).length, "count");
        b.text("health.method", "How the health score works", "Rule-based: starts at 100 and deducts points for overdue share, oldest overdue invoice, order recency vs the account's usual rhythm, sales trend, credit use and open high-severity complaints. Not a validated prediction.");
        for (const p of accountsNeedingAttention(profiles, hasPartners ? dist[0]?.customer_type : undefined).slice(0, 5)) {
          b.add(
            `health.cust.${p.customer_id}`,
            `${p.customer_name} (${p.region}) health score`,
            p.healthScore,
            "score",
            `${p.healthScore} / 100 (${p.healthBand}): ${p.deductions.map((d) => d.evidence).join("; ")}`,
          );
        }
        limitations.push("Health-score thresholds are starting assumptions and should be tuned with the sales and finance teams.");
        break;
      }
      case "product_performance": {
        const pr = productPerformance(model, f);
        b.add("prod.portfolioMargin", "Portfolio estimated gross margin", pr.portfolioMarginPct, "%");
        for (const r of pr.rows.filter((x) => x.flags.length).slice(0, 6)) {
          b.add(`prod.flag.${r.key}`, `${r.label} (${r.category})`, r.estGrossMarginPct, "%", `net sales ${formatPKR(r.netSales)}; estimated margin ${formatPct(r.estGrossMarginPct)}; average discount ${formatPct(r.avgDiscountPct)}; ${r.flags.join("; ")}`);
        }
        for (const r of breakdown(model, f, "product_category").slice(0, 5)) {
          b.add(`prod.cat.${r.key}`, `${r.label} category`, r.estGrossMarginPct, "%", `net sales ${formatPKR(r.netSales)} (${formatSignedPct(r.changePct)}); estimated margin ${formatPct(r.estGrossMarginPct)}`);
        }
        for (const an of detectSalesAnomalies(model, f).slice(0, 4)) {
          b.add(`anom.${an.dimension}.${an.key}.${an.month}`, `Unusual month: ${an.label}, ${formatMonth(an.month)}`, an.z, "count", `${formatPKR(an.value)} vs a 12-month median of ${formatPKR(an.baselineMedian)} (modified z-score ${an.z.toFixed(1)}, ${an.direction} normal)`);
        }
        limitations.push("Unusual-month flags are statistical outliers versus the product's own recent history, not explanations.");
        break;
      }
      case "collection_scenario": {
        const pct = opts.scenarioPct ?? 10;
        const s = collectionUpliftScenario(model, f, pct, k);
        b.text("scn.assumption", "Scenario assumption", s.assumptions[0]);
        for (const m of s.metrics) {
          b.add(`scn.${m.label}.baseline`, `${m.label}: baseline`, m.baseline, m.unit === "PKR" ? "PKR" : m.unit === "days" ? "days" : "%");
          b.add(`scn.${m.label}.scenario`, `${m.label}: with ${pct}% more of overdue collected`, m.scenario, m.unit === "PKR" ? "PKR" : m.unit === "days" ? "days" : "%");
        }
        limitations.push("This is a hypothetical calculation from a stated assumption, not a prediction that the extra collection will happen.");
        break;
      }
      case "complaint_patterns": {
        const ins = complaintInsights(model, f);
        b.add("cmpi.period", `Complaints opened in the period (${formatPeriod(f.start, f.end)})`, ins.periodComplaints, "count");
        const rising = ins.categoryTrend.filter((t) => t.increasing);
        const trendRows = rising.length ? rising.slice(0, 4) : ins.categoryTrend.slice(0, 3);
        for (const t of trendRows) {
          b.add(`cmpi.trend.${t.category}`, `${t.category}: complaints in the last ${ins.trendWindowDays} days${t.increasing ? " (increasing)" : ""}`, t.recent, "count", `${t.recent} in the ${ins.trendWindowDays} days to ${ins.asOf} vs ${t.previous} in the ${ins.trendWindowDays} days before`);
        }
        b.add("cmpi.risingCount", "Categories flagged as increasing", rising.length, "count", `${rising.length} (rule: at least 3 recent complaints, at least 2 more than before and at least 1.5 times the earlier count)`);
        for (const r0 of ins.byRegion.slice(0, 4)) b.add(`cmpi.region.${r0.key}`, `Complaints in the period, ${r0.key} region`, r0.count, "count", `${r0.count} opened, ${r0.open} still open`);
        for (const r0 of ins.bySegment.slice(0, 3)) b.add(`cmpi.segment.${r0.key}`, `Complaints in the period from ${r0.key} customers`, r0.count, "count", `${r0.count} opened, ${r0.open} still open`);
        for (const p0 of ins.byProduct.slice(0, 3)) b.add(`cmpi.product.${p0.key}`, `Complaints in the period on ${p0.label}`, p0.count, "count", `${p0.count} opened; most common: ${p0.topCategory}`);
        b.add("cmpi.repeatCustomers", "Customers with repeat complaints (180 days)", ins.repeatCustomers.length, "count");
        for (const rc of ins.repeatCustomers.slice(0, 3)) b.add(`cmpi.repeat.${rc.customer_id}`, `Repeat complaints: ${rc.name}`, rc.count, "count", `${rc.count} complaints in 180 days (${rc.categories.join(", ")}); ${rc.open} open`);
        for (const ri of ins.recurringIssues.slice(0, 3)) b.add(`cmpi.recurring.${ri.product_id}.${ri.category}`, `Recurring issue: ${ri.category} on ${ri.product}`, ri.count, "count", `${ri.count} complaints from ${ri.customers} customers in the last ${getSettings().rules.complaints.systemicWindowDays} days; ${ri.open} open`);
        const sa = ins.salesAssociation;
        if (sa.withComplaints.n >= 5 && sa.without.n >= 5) {
          b.add("cmpi.assoc.with", "Median 90-day sales change, customers with a complaint in the last 90 days", sa.withComplaints.medianTrendPct, "%", `${formatSignedPct(sa.withComplaints.medianTrendPct)} (n = ${sa.withComplaints.n} customers)`);
          b.add("cmpi.assoc.without", "Median 90-day sales change, customers without a complaint in the last 90 days", sa.without.medianTrendPct, "%", `${formatSignedPct(sa.without.medianTrendPct)} (n = ${sa.without.n} customers)`);
          limitations.push("The sales comparison between customers with and without complaints is an association; it does not show that complaints caused any sales change.");
        }
        limitations.push("Complaint counts are small; a difference of a few complaints can be noise. Patterns show where to look, not causes.");
        const unclassified = model.complaints.filter((c) => c.origin === "register" && c.category === "Not yet classified").length;
        if (unclassified) limitations.push(`${unclassified} complaint(s) entered in the app are not classified yet and are counted as "Not yet classified".`);
        break;
      }
      case "complaint_priorities": {
        const ins = complaintInsights(model, f);
        for (const o of ins.openByPriority) b.add(`cmpp.open.${o.priority}`, `Open ${o.priority.toLowerCase()}-priority complaints on ${ins.asOf}`, o.total, "count", `${o.total} (${o.age["0-7"]} up to 7 days old, ${o.age["8-30"]} 8-30 days, ${o.age["31-60"] + o.age["60+"]} older)`);
        const asOf = ins.asOf;
        const open = model.complaints.filter((c) => c.date_opened <= asOf && (c.status !== "Resolved" || (c.date_resolved !== "" && c.date_resolved > asOf)));
        const pr = (c: (typeof open)[number]) => c.priority ?? severityToPriority(c.severity);
        b.add("cmpp.escalated", "Open complaints escalated and awaiting management acknowledgement", open.filter((c) => c.escalated).length, "count");
        const urgent = open
          .filter((c) => pr(c) === "Critical" || pr(c) === "High" || c.escalated)
          .sort((a, b2) => ["Critical", "High", "Medium", "Low"].indexOf(pr(a)) - ["Critical", "High", "Medium", "Low"].indexOf(pr(b2)) || (a.date_opened < b2.date_opened ? -1 : 1))
          .slice(0, 5);
        for (const c of urgent) {
          const name = model.customersById.get(c.customer_id)?.customer_name ?? "customer not in master";
          const age = Math.max(0, Math.round((Date.parse(asOf) - Date.parse(c.date_opened)) / 86_400_000));
          b.add(`cmpp.item.${c.complaint_id}`, `Complaint ${c.caseId ?? c.complaint_id} (${name})`, age, "days", `${c.category} on ${c.product_name}; ${pr(c)} priority${c.priorityConfirmed ? " (confirmed)" : ""}; ${c.assigned_team}; open ${age} days${c.escalated ? "; escalated" : ""}`);
        }
        const depts = new Map<string, { open: number; high: number }>();
        for (const c of open) {
          const d = depts.get(c.assigned_team) ?? { open: 0, high: 0 };
          d.open += 1;
          if (pr(c) === "High" || pr(c) === "Critical") d.high += 1;
          depts.set(c.assigned_team, d);
        }
        for (const [d, v] of [...depts.entries()].sort((a, b2) => b2[1].high - a[1].high || b2[1].open - a[1].open).slice(0, 5)) b.add(`cmpp.dept.${d}`, `${d}: open complaints`, v.open, "count", `${v.open} open, ${v.high} high or critical`);
        for (const rc of ins.riskCustomers.slice(0, 4)) b.add(`cmpp.risk.${rc.customer_id}`, `Elevated complaint risk: ${rc.name}`, rc.score, "score", `${rc.score} risk points: ${rc.reasons.join("; ")}`);
        if (opts.cases?.length) {
          const st = registerStats(opts.cases, opts.now ?? new Date());
          b.add("cmpp.reg.awaitingReview", "Complaints with a suggestion awaiting human review", st.awaitingReview, "count");
          b.add("cmpp.reg.notTriaged", "Open complaints not yet triaged", st.notTriaged, "count");
          b.add("cmpp.reg.responseOverdue", "Open complaints past their first-response target", st.responseOverdue, "count");
          const retention = opts.cases.filter((c) => isOpenStatus(c.status) && c.assessments.at(-1)?.rules.hits.some((h) => h.id === "retention" || h.id === "legal"));
          for (const c of retention.slice(0, 3)) {
            const name = c.customerId ? (model.customersById.get(c.customerId)?.customer_name ?? c.customerId) : c.customerNameEntered;
            const hit = c.assessments.at(-1)!.rules.hits.find((h) => h.id === "retention" || h.id === "legal")!;
            b.text(`cmpp.retention.${c.id}`, `Retention or legal risk in complaint ${c.id} (${name})`, `${hit.label}: ${hit.reason} Status ${c.status}; priority ${currentPriority(c).priority ?? "not set"}.`);
          }
        }
        limitations.push("Priorities for complaints not reviewed in the app come from the imported severity (High, Medium, Low).");
        limitations.push("Risk points are transparent prioritisation rules, not a prediction that a customer will leave.");
        break;
      }
      case "complaints": {
        const cs = complaintSummary(model, f);
        b.add("cmp.open", `Open complaints on ${cs.asOf}`, cs.openAtAsOf, "count");
        b.add("cmp.openHigh", "Open high-severity complaints", cs.openHighSeverity, "count");
        b.add("cmp.opened", "Complaints opened in the period", cs.openedInPeriod, "count");
        b.add("cmp.avgResolution", "Average resolution time (complaints resolved in period)", cs.avgResolutionDays, "days");
        b.add("cmp.openClaims", "Claim value on open complaints", cs.openClaimValue, "PKR");
        for (const t of cs.byTeam.slice(0, 4)) b.add(`cmp.team.${t.key}`, `${t.key} team`, t.open, "count", `${t.open} open, ${t.opened} opened in period`);
        for (const sp of cs.spikes.slice(0, 3)) {
          b.add(`cmp.spike.${sp.product_id}`, `Complaint spike: ${sp.product_name}`, sp.recentCount, "count", `${sp.recentCount} complaints in the last ${sp.recentDays} days vs about ${sp.baselinePerWindow.toFixed(1)} normally; mostly ${sp.topCategory}`);
        }
        for (const c of cs.openList.filter((x) => x.severity === "High").slice(0, 3)) {
          b.add(`cmp.item.${c.complaint_id}`, `Open complaint ${c.complaint_id}`, c.ageDays, "days", `${c.category} on ${c.product_name}, ${c.severity} severity, owned by ${c.assigned_team}, open ${c.ageDays} days`);
        }
        break;
      }
      case "forecast": {
        const fc = backtestAndForecast(model, f);
        if (!fc.sufficient) {
          b.text("fc.insufficient", "Forecast availability", fc.reason ?? "Insufficient history");
          break;
        }
        for (const s of fc.scores) b.add(`fc.mape.${s.method}`, `Backtest error (MAPE, last ${fc.holdoutMonths} months): ${s.label}`, s.mapePct, "%");
        if (fc.best) b.text("fc.best", "Method with lowest backtest error", METHOD_LABELS[fc.best]);
        for (const o of fc.outlook) b.add(`fc.${o.month}`, `Baseline forecast for ${formatMonth(o.month)}`, o.forecast, "PKR", `${formatPKR(o.forecast)} (rough range ${formatPKR(o.low)} to ${formatPKR(o.high)})`);
        limitations.push(...fc.notes);
        break;
      }
      case "data_quality": {
        const bd = model.bundle;
        b.add("dq.orders", "Order rows loaded", bd.orders.length, "count");
        b.add("dq.invoices", "Invoice rows loaded", bd.invoices.length, "count");
        b.add("dq.customers", "Customer rows loaded", bd.customers.length, "count");
        b.add("dq.complaints", "Complaint rows loaded", bd.complaints.length, "count");
        b.text("dq.range", "Date range in the data", `${model.minDate} to ${model.maxDate}`);
        const warnings = checkBundleConsistency(bd);
        b.text("dq.warnings", "Cross-file consistency warnings", warnings.length ? warnings.join(" ") : "None found.");
        break;
      }
      case "next_steps": {
        b.add("kpi.netSales", "Net sales in the period", k.netSales, "PKR");
        b.add("kpi.salesAttainmentPct", "Sales target attainment", k.salesAttainmentPct, "%");
        b.add("kpi.collectionAttainmentPct", "Collection target attainment", k.collectionAttainmentPct, "%");
        b.add("kpi.estGrossMarginPct", "Estimated gross margin", k.estGrossMarginPct, "%");
        b.add("kpi.overdue", `Overdue balance on ${k.period.asOf}`, k.overdue, "PKR");
        b.add("kpi.overduePct", "Overdue share of outstanding", k.overduePct, "%");
        b.add("kpi.openComplaints", "Open complaints", k.openComplaints, "count");
        const att = accountsNeedingAttention(customerProfiles(model, f));
        b.add("next.attentionCount", "Active accounts in the 'Needs attention' health band", att.filter((p) => p.healthBand === "Needs attention").length, "count");
        for (const p of att.slice(0, 3)) {
          b.add(`health.cust.${p.customer_id}`, `${p.customer_name} (${p.customer_type}, ${p.region}) health score`, p.healthScore, "score", `${p.healthScore} / 100: ${p.deductions.map((d) => d.evidence).join("; ")}`);
        }
        const cs = complaintSummary(model, f);
        for (const sp of cs.spikes.slice(0, 2)) b.add(`cmp.spike.${sp.product_id}`, `Complaint spike: ${sp.product_name}`, sp.recentCount, "count", `${sp.recentCount} complaints in the last ${sp.recentDays} days vs about ${sp.baselinePerWindow.toFixed(1)} normally; mostly ${sp.topCategory}`);
        const flagged = productPerformance(model, f).rows.filter((r) => r.flags.length);
        b.add("next.flaggedProducts", "Products with a sales or margin flag", flagged.length, "count");
        break;
      }
    }
  }

  if (!k.targetsAvailable) limitations.push("Target attainment is unavailable for this filter selection.");

  return {
    question,
    analyses,
    period: k.period,
    filtersDescription: describeFilters(f),
    dataSource:
      model.bundle.source === "sample"
        ? "Bundled synthetic sample data (fictional company)"
        : model.bundle.source === "pipeline"
          ? "Company data loaded by the data pipeline"
          : "Company data uploaded as CSV files",
    currency: getSettings().currency,
    industry: getSettings().industry,
    items: b.items,
    limitations: [...new Set(limitations)].slice(0, 15),
  };
}

/** Lookup helper used by the demo explainer and tests. */
export function byKey(packet: EvidencePacket, key: string): EvidenceItem | undefined {
  return packet.items.find((i) => i.key === key);
}
