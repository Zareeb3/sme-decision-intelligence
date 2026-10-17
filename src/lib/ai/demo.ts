/**
 * Demo-mode explainer: a deterministic, template-based writer used when no AI
 * provider is configured (or when a live call fails).
 *
 * It is clearly labelled in the UI as "Demo mode — no AI model was called".
 * It only restates evidence items and applies simple, visible rules to
 * propose hypotheses and next steps, so it is grounded by construction.
 */
import { byKey } from "./evidence";
import type { AnalystResponse, EvidenceItem, EvidencePacket } from "./types";

type Fact = AnalystResponse["facts"][number];
type Hyp = AnalystResponse["hypotheses"][number];
type Rec = AnalystResponse["recommendations"][number];

export function demoExplain(packet: EvidencePacket): AnalystResponse {
  const facts: Fact[] = [];
  const hyps: Hyp[] = [];
  const recs: Rec[] = [];
  const unc: string[] = [];
  const follow: string[] = [];
  const summary: string[] = [];

  const get = (k: string) => byKey(packet, k);
  const withPrefix = (p: string) => packet.items.filter((i) => i.key.startsWith(p));
  const fact = (statement: string, ...items: (EvidenceItem | undefined)[]) => {
    const ids = items.filter(Boolean).map((i) => i!.id);
    if (ids.length) facts.push({ statement, evidence_ids: ids });
  };
  const val = (k: string) => get(k)?.value ?? null;

  for (const a of packet.analyses) {
    switch (a) {
      case "sales_vs_collections": {
        const ns = get("kpi.netSales");
        const sa = get("kpi.salesAttainmentPct");
        const col = get("kpi.collections");
        const ca = get("kpi.collectionAttainmentPct");
        if (sa && ca && sa.value !== null && ca.value !== null) {
          fact(`Net sales were ${ns?.display}, ${sa.display} of target, while collections were ${col?.display}, ${ca.display} of target.`, ns, sa, col, ca);
          if (sa.value >= 100 && ca.value < 100) summary.push(`Sales beat target (${sa.display}) but collections fell short (${ca.display}).`);
          else summary.push(`Sales reached ${sa.display} of target and collections ${ca.display}.`);
        } else if (ns && col) {
          fact(`Net sales were ${ns.display} and collections were ${col.display}; targets are not available for this selection.`, ns, col);
        }
        const r1 = get("diag.collectionsToSalesPct");
        const r0 = get("diag.prevCollectionsToSalesPct");
        if (r1 && r0) fact(`Collections equalled ${r1.display} of net sales this period, compared with ${r0.display} in the previous period.`, r1, r0);
        const od = get("kpi.overdue");
        const pod = get("diag.prevOverdue");
        if (od && pod) fact(`The overdue balance moved from ${pod.display} to ${od.display}.`, pod, od);

        const regions = withPrefix("diag.region.");
        const worst = regions[0];
        if (worst && (worst.value ?? 0) < 0) {
          const name = worst.key.replace("diag.region.", "");
          fact(`${name} has the largest collection shortfall: ${worst.display}.`, worst);
          hyps.push({
            statement: `Sales pushed into ${name} have not yet converted into cash, which may account for much of the company-wide collection gap.`,
            evidence_ids: [worst.id],
            how_to_verify: `Compare invoice dates and payment terms for ${name} customers; check whether period-end orders carry longer credit or extra discounts.`,
          });
          recs.push({ action: `Review open and overdue invoices in ${name} with the regional sales and finance leads this week.`, rationale: "This region carries the largest gap between collections and target.", evidence_ids: [worst.id], priority: "high" });
        }
        const delays = withPrefix("diag.delay.");
        if (delays.length) {
          const d = delays[0];
          fact(`${d.label.split(":")[0]} customers paid later than before: ${d.display}.`, d);
          hyps.push({
            statement: `Slower payment by ${d.label.split(":")[0]} customers may be contributing to the shortfall.`,
            evidence_ids: delays.map((x) => x.id),
            how_to_verify: "Check with the credit team whether terms were extended or disputes were raised for these accounts.",
          });
        }
        const movers = withPrefix("diag.mover.");
        if (movers.length) {
          fact(`The largest increases in overdue balance came from ${movers.map((m) => `${m.label.split(" (")[0]} (${m.display})`).join("; ")}.`, ...movers);
          recs.push({ action: `Schedule collection calls for ${movers.map((m) => m.label.split(" (")[0]).join(", ")}.`, rationale: "These accounts added the most to the overdue balance.", evidence_ids: movers.map((m) => m.id), priority: "high" });
        }
        const ch = withPrefix("drivers.channel.");
        if (ch.length) fact(`By channel: ${ch.map((c) => `${c.label.split(" channel")[0]} ${c.display}`).join("; ")}.`, ...ch);
        unc.push("The data shows timing and amounts of payments, not the reasons customers paid late.");
        follow.push("Which distributors need attention?", "What could happen if collections improve by 10%?");
        break;
      }
      case "performance_drivers": {
        for (const dim of ["region", "channel"]) {
          const rows = withPrefix(`drivers.${dim}.`);
          if (rows.length) fact(`By ${dim}: ${rows.map((r) => `${r.label.split(" (")[0]} ${r.display.split(", estimated")[0]}`).join("; ")}.`, ...rows);
        }
        const cust = withPrefix("drivers.customer.");
        if (cust.length) {
          fact(`Customers with the largest change in net sales: ${cust.map((c) => `${c.label.split(":")[0]} (${c.display})`).join("; ")}.`, ...cust);
          hyps.push({ statement: "A small number of accounts may explain much of the period's change in sales.", evidence_ids: cust.map((c) => c.id), how_to_verify: "Ask the account managers whether these changes reflect project timing, stock building or lost business." });
        }
        if (!summary.length) summary.push("Sales performance is broken down by region, channel and the customers whose sales changed most.");
        follow.push("Which customers contribute the largest share of revenue?");
        break;
      }
      case "customer_concentration": {
        const t1 = get("conc.top1"), t5 = get("conc.top5"), t10 = get("conc.top10"), n80 = get("conc.for80"), hhi = get("conc.hhi");
        fact(`The largest customer accounts for ${t1?.display} of net sales, the top 5 for ${t5?.display} and the top 10 for ${t10?.display}.`, t1, t5, t10);
        fact(`${n80?.display} customers make up 80% of net sales; the HHI is ${hhi?.display}.`, n80, hhi);
        const top = withPrefix("conc.cust.");
        if (top.length) fact(`Largest customers: ${top.map((c) => `${c.label.split(" (")[0]} (${c.display})`).join("; ")}.`, ...top);
        summary.push(`The top 5 customers generate ${t5?.display} of net sales.`);
        if ((t5?.value ?? 0) > 40) recs.push({ action: "Agree account plans and credit reviews for the top 5 customers.", rationale: "A large share of sales depends on a few accounts.", evidence_ids: [t5!.id], priority: "medium" });
        unc.push("Accounts that share an owner are counted separately, so true dependence may be higher.");
        break;
      }
      case "receivables_risk": {
        const o = get("kpi.outstanding"), od = get("kpi.overdue"), p = get("kpi.overduePct"), o90 = get("kpi.over90"), dso = get("kpi.dso90");
        fact(`Outstanding receivables are ${o?.display}, of which ${od?.display} (${p?.display}) is overdue.`, o, od, p);
        if (o90) fact(`${o90.display} is more than 90 days past due.`, o90);
        if (dso) fact(`Simple DSO is ${dso.display}.`, dso);
        const top = withPrefix("recv.cust.");
        if (top.length) {
          fact(`Largest overdue accounts: ${top.slice(0, 3).map((c) => `${c.label.split(" (")[0]} (${c.display.split(";")[0]})`).join("; ")}.`, ...top.slice(0, 3));
          recs.push({ action: `Prioritise collection follow-up for ${top.slice(0, 3).map((c) => c.label.split(" (")[0]).join(", ")}.`, rationale: "These accounts hold the largest overdue balances.", evidence_ids: top.slice(0, 3).map((c) => c.id), priority: "high" });
        }
        if (o90 && (o90.value ?? 0) > 0) recs.push({ action: "Review 90+ day balances with finance for disputes, provisioning or credit holds.", rationale: "Old balances are the least likely to be recovered without action.", evidence_ids: [o90.id], priority: "medium" });
        summary.push(`${od?.display} of receivables is overdue (${p?.display} of outstanding).`);
        break;
      }
      case "distributor_attention": {
        const att = get('health.dist.Needs attention'), watch = get("health.dist.Watch"), ok = get("health.dist.Healthy");
        const group = (att?.label.split(" in band")[0] ?? "Customers").toLowerCase();
        fact(`Among ${group}, ${att?.display} are in "Needs attention", ${watch?.display} in "Watch" and ${ok?.display} are "Healthy" under the rule-based score.`, att, watch, ok);
        const list = withPrefix("health.cust.");
        for (const c of list.slice(0, 3)) fact(`${c.label.replace(" health score", "")}: ${c.display}.`, c);
        if (list.length) recs.push({ action: `Hold account reviews with ${list.slice(0, 3).map((c) => c.label.split(" (")[0]).join(", ")}.`, rationale: "They have the lowest health scores; the listed rule deductions show what to discuss.", evidence_ids: list.slice(0, 3).map((c) => c.id), priority: "high" });
        summary.push(`${att?.display} of the ${group} need attention under transparent business rules.`);
        unc.push("The health score is a set of business rules, not a validated prediction of default or churn.");
        break;
      }
      case "product_performance": {
        const pm = get("prod.portfolioMargin");
        const flagged = withPrefix("prod.flag.");
        if (pm) fact(`Portfolio estimated gross margin is ${pm.display}.`, pm);
        for (const p of flagged.slice(0, 4)) fact(`${p.label}: ${p.display}.`, p);
        const anomalies = withPrefix("anom.");
        for (const an of anomalies.slice(0, 2)) fact(`${an.label}: ${an.display}.`, an);
        const disc = flagged.find((p) => /below portfolio/.test(p.display));
        if (disc) {
          hyps.push({ statement: `Higher discounting or rising costs may be compressing the margin on ${disc.label.split(" (")[0]}.`, evidence_ids: [disc.id, ...(pm ? [pm.id] : [])], how_to_verify: "Compare discount and unit-cost trends for this product over the last 4 quarters." });
          recs.push({ action: `Review pricing and discount approvals for ${disc.label.split(" (")[0]}.`, rationale: "Its estimated margin is well below the portfolio.", evidence_ids: [disc.id], priority: "medium" });
        }
        summary.push(`${flagged.length} product(s) carry a sales or margin flag.`);
        break;
      }
      case "collection_scenario": {
        const as = get("scn.assumption");
        const c0 = get("scn.Collections in period.baseline"), c1 = get("scn.Collections in period.scenario");
        const a0 = get("scn.Collection target attainment.baseline"), a1 = get("scn.Collection target attainment.scenario");
        const o0 = get("scn.Overdue balance.baseline"), o1 = get("scn.Overdue balance.scenario");
        if (as) fact(`Assumption: ${as.display}`, as);
        fact(`Collections would move from ${c0?.display} to ${c1?.display}.`, c0, c1);
        if (a0?.value != null && a1?.value != null) fact(`Collection target attainment would move from ${a0.display} to ${a1.display}.`, a0, a1);
        fact(`The overdue balance would fall from ${o0?.display} to ${o1?.display}.`, o0, o1);
        summary.push(`If the assumption held, collections would rise from ${c0?.display} to ${c1?.display}. This is a hypothetical calculation, not a forecast.`);
        unc.push("Whether customers can pay this amount is not known from the data.");
        follow.push("Which accounts have significant outstanding balances or overdue invoices?");
        break;
      }
      case "complaint_patterns": {
        const n = get("cmpi.period");
        if (n) fact(`${n.display} complaints were opened in the period.`, n);
        const trends = withPrefix("cmpi.trend.");
        const rising = trends.filter((t) => /increasing/.test(t.label));
        if (rising.length) fact(`Increasing categories: ${rising.map((t) => `${t.label.split(":")[0]} (${t.display})`).join("; ")}.`, ...rising);
        else if (trends.length) fact(`No category meets the increase rule. Largest recent categories: ${trends.map((t) => `${t.label.split(":")[0]} (${t.display})`).join("; ")}.`, ...trends, get("cmpi.risingCount"));
        const regions = withPrefix("cmpi.region.");
        if (regions.length) fact(`By region: ${regions.map((r) => `${r.label.split(", ")[1]}: ${r.display}`).join("; ")}.`, ...regions);
        const segs = withPrefix("cmpi.segment.");
        if (segs.length) fact(`By customer segment: ${segs.map((r) => `${r.label.replace("Complaints in the period from ", "").replace(/ customers$/, "")}: ${r.display}`).join("; ")}.`, ...segs);
        const rec = withPrefix("cmpi.recurring.");
        for (const r of rec) {
          fact(`${r.label}: ${r.display}.`, r);
          hyps.push({ statement: `Repeated ${r.label.replace("Recurring issue: ", "").toLowerCase()} complaints from several customers may share one cause, such as a batch, a process step or a route.`, evidence_ids: [r.id], how_to_verify: "Trace the affected orders to production batches, dispatch dates and transporters." });
        }
        if (rec.length) recs.push({ action: `Open a root-cause investigation for: ${rec.map((r) => r.label.replace("Recurring issue: ", "")).join("; ")}.`, rationale: "The same issue on the same product is being reported by several customers.", evidence_ids: rec.map((r) => r.id), priority: "high" });
        const rep = withPrefix("cmpi.repeat.");
        const repN = get("cmpi.repeatCustomers");
        if (repN) fact(`${repN.display} customers raised more than one complaint in 180 days${rep.length ? `, led by ${rep.map((r) => `${r.label.replace("Repeat complaints: ", "")} (${r.display.split(" (")[0]})`).join(", ")}` : ""}.`, repN, ...rep);
        const aw = get("cmpi.assoc.with"), ao = get("cmpi.assoc.without");
        if (aw && ao) {
          fact(`Median 90-day sales change was ${aw.display} for customers with a recent complaint and ${ao.display} for customers without one.`, aw, ao);
          unc.push("The sales comparison is an association between two groups of customers; it does not show that complaints caused the difference.");
        }
        summary.push(rising.length ? `${rising.length} complaint categor${rising.length === 1 ? "y is" : "ies are"} increasing${rec.length ? `, and ${rec.length} recurring product issue(s) need investigation` : ""}.` : "No complaint category meets the increase rule in the last 90 days.");
        unc.push("Complaint counts are small, so a few complaints can change a trend.");
        break;
      }
      case "complaint_priorities": {
        const levels = ["Critical", "High", "Medium", "Low"].map((p) => get(`cmpp.open.${p}`));
        fact(`Open complaints by priority: ${levels.filter(Boolean).map((l) => `${l!.label.split(" ")[1].replace("-priority", "")} ${l!.value}`).join(", ")}.`, ...levels);
        const esc = get("cmpp.escalated");
        if (esc) fact(`${esc.display} open complaints are escalated and waiting for management acknowledgement.`, esc);
        const items = withPrefix("cmpp.item.");
        if (items.length) {
          fact(`Most urgent open complaints: ${items.map((i) => `${i.label.replace("Complaint ", "")}: ${i.display}`).join(" | ")}.`, ...items);
          recs.push({ action: `Review today: ${items.slice(0, 3).map((i) => i.label.replace("Complaint ", "")).join(", ")}.`, rationale: "They carry the highest priority or an escalation.", evidence_ids: items.slice(0, 3).map((i) => i.id), priority: "high" });
        }
        const risk = withPrefix("cmpp.risk.");
        if (risk.length) {
          fact(`Customers with elevated complaint risk: ${risk.map((r) => `${r.label.replace("Elevated complaint risk: ", "")} (${r.display})`).join("; ")}.`, ...risk);
          recs.push({ action: `Ask the account owners to call ${risk.slice(0, 3).map((r) => r.label.replace("Elevated complaint risk: ", "")).join(", ")}.`, rationale: "Open high-priority complaints, escalations or repeat issues put these relationships at risk.", evidence_ids: risk.slice(0, 3).map((r) => r.id), priority: "high" });
          hyps.push({ statement: "Unresolved complaints may be contributing to weaker ordering by some of these customers.", evidence_ids: risk.map((r) => r.id), how_to_verify: "Ask the account owners and compare order patterns before and after the complaint; other causes (season, credit limits, competition) are possible." });
        }
        const ret = withPrefix("cmpp.retention.");
        for (const r of ret) fact(`${r.label}: ${r.display}`, r);
        const depts = withPrefix("cmpp.dept.");
        if (depts.length) {
          fact(`Open complaints by department: ${depts.map((d) => `${d.label.split(":")[0]} ${d.display}`).join("; ")}.`, ...depts);
          recs.push({ action: `${depts[0].label.split(":")[0]} should prioritise its high and critical complaints first.`, rationale: "It holds the most high-priority open complaints.", evidence_ids: [depts[0].id], priority: "medium" });
        }
        const rv = get("cmpp.reg.awaitingReview"), nt = get("cmpp.reg.notTriaged"), od = get("cmpp.reg.responseOverdue");
        if (rv && nt && od) fact(`${rv.display} complaints are awaiting human review, ${nt.display} are not yet triaged and ${od.display} are past their first-response target.`, rv, nt, od);
        summary.push(`${esc?.display ?? "No"} escalated complaints await management${items.length ? `; ${items.length} complaints are critical, high-priority or escalated` : ""}.`);
        unc.push("Risk points and priorities are transparent rules for ordering work, not predictions.");
        break;
      }
      case "complaints": {
        const op = get("cmp.open"), hi = get("cmp.openHigh"), opened = get("cmp.opened"), res = get("cmp.avgResolution");
        fact(`${op?.display} complaints are open, ${hi?.display} of them high severity; ${opened?.display} were opened in the period.`, op, hi, opened);
        if (res?.value != null) fact(`Complaints resolved in the period took ${res.display} on average.`, res);
        const spikes = withPrefix("cmp.spike.");
        for (const s of spikes) {
          fact(`${s.label}: ${s.display}.`, s);
          hyps.push({ statement: `The rise in complaints on ${s.label.replace("Complaint spike: ", "")} may point to a specific production batch.`, evidence_ids: [s.id], how_to_verify: "Match the complaint order IDs to production batch and dispatch records." });
          recs.push({ action: `Ask Quality to investigate ${s.label.replace("Complaint spike: ", "")} and hold suspect stock if a batch link is confirmed.`, rationale: "Complaints are well above this product's normal rate.", evidence_ids: [s.id], priority: "high" });
        }
        const items = withPrefix("cmp.item.");
        if (items.length) fact(`Open high-severity complaints: ${items.map((i) => i.display).join("; ")}.`, ...items);
        summary.push(`${op?.display} complaints are open${spikes.length ? `, with an unusual rise on ${spikes.length} product(s)` : ""}.`);
        break;
      }
      case "forecast": {
        const ins = get("fc.insufficient");
        if (ins) {
          fact(ins.display, ins);
          unc.push("Not enough history for a forecast.");
          break;
        }
        const best = get("fc.best");
        const scores = withPrefix("fc.mape.");
        fact(`Four baseline methods were backtested: ${scores.map((s) => `${s.label.split(": ")[1]} ${s.display}`).join("; ")}.`, ...scores);
        const outlook = packet.items.filter((i) => /^fc\.\d{4}-\d{2}$/.test(i.key));
        if (best) fact(`The lowest-error method was ${best.display}. Its outlook: ${outlook.map((o) => `${o.label.replace("Baseline forecast for ", "")} ${o.display}`).join("; ")}.`, best, ...outlook);
        summary.push("A baseline outlook is shown with its backtest error; treat it as a reference point, not a target.");
        unc.push("Baselines ignore planned price changes, campaigns and capacity.");
        break;
      }
      case "data_quality": {
        const items = ["dq.orders", "dq.invoices", "dq.customers", "dq.complaints"].map(get);
        fact(`Loaded ${items.map((i) => `${i?.display} ${i?.label.replace(" rows loaded", "").toLowerCase()} rows`).join(", ")}.`, ...items);
        const r = get("dq.range");
        if (r) fact(`Data covers ${r.display}.`, r);
        const w = get("dq.warnings");
        if (w) fact(`Consistency check: ${w.display}`, w);
        summary.push("Findings marked as facts come straight from validated data; hypotheses and recommendations need confirmation by the team.");
        break;
      }
      case "next_steps": {
        const sa = get("kpi.salesAttainmentPct"), ca = get("kpi.collectionAttainmentPct"), od = get("kpi.overdue"), m = get("kpi.estGrossMarginPct");
        if (sa && ca) fact(`Sales attainment is ${sa.display} and collection attainment ${ca.display}.`, sa, ca);
        if (od) fact(`Overdue receivables stand at ${od.display}.`, od);
        if (m) fact(`Estimated gross margin is ${m.display}.`, m);
        const accts = withPrefix("health.cust.");
        if (accts.length) recs.push({ action: `Review the lowest-scoring accounts first: ${accts.map((a2) => a2.label.split(" (")[0]).join(", ")}.`, rationale: "Their rule deductions combine overdue balances, slowing orders or credit overuse.", evidence_ids: accts.map((a2) => a2.id), priority: "high" });
        const sp = withPrefix("cmp.spike.");
        if (sp.length) recs.push({ action: `Investigate the complaint rise on ${sp.map((s) => s.label.replace("Complaint spike: ", "")).join(", ")}.`, rationale: "Unusual complaint volume can signal a quality problem affecting several customers.", evidence_ids: sp.map((s) => s.id), priority: "high" });
        const fp = get("next.flaggedProducts");
        if (fp && (fp.value ?? 0) > 0) recs.push({ action: "Review flagged products on the Sales page for declining sales or weak margins.", rationale: `${fp.display} product(s) carry a flag.`, evidence_ids: [fp.id], priority: "medium" });
        if (!summary.length) summary.push("Priorities combine collections, account health, complaints and product margins.");
        follow.push("Why did sales increase while collections fell behind?");
        break;
      }
    }
  }

  // names such as "Rehman Trading Co." can end in a full stop; avoid "Co.."
  const tidy = (s: string) => s.replace(/\.\.(?=\s|$)/g, ".");
  return {
    summary: tidy(summary.slice(0, 3).join(" ") || "Here is what the verified data shows for this question."),
    facts: facts.slice(0, 10).map((f) => ({ ...f, statement: tidy(f.statement) })),
    hypotheses: hyps.slice(0, 6).map((h) => ({ ...h, statement: tidy(h.statement) })),
    recommendations: recs.slice(0, 6).map((r) => ({ ...r, action: tidy(r.action) })),
    uncertainties: [...new Set(unc)].slice(0, 6),
    follow_up_questions: [...new Set(follow)].filter((q) => q.toLowerCase() !== packet.question.toLowerCase()).slice(0, 5),
  };
}
