/**
 * Question router: decides WHICH deterministic analyses answer a question.
 *
 * This is intentionally rule-based (keyword patterns), not an LLM call:
 *  - it is predictable and testable (see evals/questions.json),
 *  - it works without an API key,
 *  - it is cheap and instant.
 * The trade-off is that unusual phrasings can be misrouted. The UI always
 * shows which analyses were run, and the user can pick one explicitly.
 */
import type { Model } from "../analytics/model";
import { monthEnd, monthStart } from "../analytics/dates";
import type { Filters } from "../analytics/filters";
import type { AnalysisId } from "./types";

interface Rule {
  id: AnalysisId;
  patterns: RegExp[];
}

const RULES: Rule[] = [
  {
    id: "sales_vs_collections",
    patterns: [
      /\b(sales|revenue|sold)\b[\s\S]*\b(collect\w*|cash|payments?|recover\w*)\b/i,
      /\b(collect\w*|cash|payments?)\b[\s\S]*\b(sales|revenue)\b/i,
      /\bcollections?\b[\s\S]*\b(fell|fall|behind|lag\w*|short\w*|miss\w*|gap|below)\b/i,
    ],
  },
  {
    id: "performance_drivers",
    patterns: [
      /\bdriv(e|es|ing|ers?)\b/i,
      /\b(contribut\w*|reduc\w*)\b[\s\S]*\bperformance\b/i,
      /\bwhich (regions?|channels?)\b/i,
      /\bperformance\b/i,
      /\bwhy did (sales|revenue)\b/i,
      /\b(grow|grew|growth|increase|decrease|drop)\w*\b[\s\S]*\b(sales|revenue)\b/i,
    ],
  },
  {
    id: "customer_concentration",
    patterns: [/\bconcentrat\w*/i, /\bdepend\w*\b/i, /\b(largest|biggest|top)\b[\s\S]*\b(customers?|accounts?|share)\b/i, /\bshare of (revenue|sales)\b/i],
  },
  {
    id: "receivables_risk",
    patterns: [/\boverdue\b/i, /\boutstanding\b/i, /\breceivables?\b/i, /\baging|ageing\b/i, /\bunpaid\b/i, /\bDSO\b/i, /\bbalances?\b/i],
  },
  {
    id: "distributor_attention",
    patterns: [/\bdistributors?\b/i, /\b(need|needs|require)\w*\s+attention\b/i, /\bat[- ]risk\b/i, /\b(account|customer)\s+health\b/i, /\bfollow[- ]?up\b/i],
  },
  {
    id: "product_performance",
    patterns: [/\bproducts?\b/i, /\bsku\b/i, /\bmargins?\b/i, /\bdeclin\w*/i, /\bunusual\b/i, /\banomal\w*/i, /\bcategor(y|ies)\b/i],
  },
  {
    id: "collection_scenario",
    patterns: [/\bwhat (could|would|will|if)\b/i, /\bscenario\b/i, /\bimprove[sd]?\b[\s\S]*\bby\s+\d+/i, /\bif\b[\s\S]*\b\d+\s?%/i],
  },
  {
    id: "complaint_patterns",
    patterns: [
      /\bcomplain\w*\b[\s\S]*\b(increas\w*|rising|rise|grow\w*|trend\w*|concentrat\w*|repeat\w*|recurr\w*|pattern\w*|segment\w*)\b/i,
      /\b(increas\w*|rising|growing)\b[\s\S]*\bcomplain\w*/i,
      /\b(repeat\w*|recurring|repeated)\s+(complaints?|issues?|problems?)\b/i,
      /\boperational (issues?|problems?)\b/i,
    ],
  },
  {
    id: "complaint_priorities",
    patterns: [
      /\b(unresolved|open)\b[\s\S]*\b(high[- ]priority|critical|complaints?)\b/i,
      /\bcomplaints?\b[\s\S]*\b(attention|urgent|immediate|escalat\w*|priorit\w*)\b/i,
      /\b(immediate|management) attention\b[\s\S]*\bcomplaints?\b/i,
      /\b(retention|churn)\b/i,
      /\b(threaten\w*|lose|losing)\b[\s\S]*\bcustomers?\b/i,
      /\bdepartments?\b[\s\S]*\bpriorit\w*/i,
    ],
  },
  {
    id: "complaints",
    patterns: [/\bcomplain\w*/i, /\bquality\b/i, /\boperational\b/i, /\bissues?\b/i, /\bshade\b/i, /\bbreakage\b/i, /\bclaims?\b/i],
  },
  {
    id: "forecast",
    patterns: [/\bforecast\w*/i, /\bpredict\w*/i, /\boutlook\b/i, /\bnext (month|quarter)\b/i, /\bexpect\w*\b[\s\S]*\bsales\b/i],
  },
  {
    id: "data_quality",
    patterns: [/\bsupported by (the )?data\b/i, /\bfurther investigation\b/i, /\bdata quality\b/i, /\blimitations?\b/i, /\bconfiden\w*/i, /\bmissing\b/i, /\breliab\w*/i],
  },
  {
    id: "next_steps",
    patterns: [/\bwhat should\b/i, /\bnext steps?\b/i, /\bpriorit\w*/i, /\brecommend\w*/i, /\binvestigate or do\b/i, /\bfocus on\b/i],
  },
];

export interface RouteResult {
  analyses: AnalysisId[];
  matched: { id: AnalysisId; pattern: string }[];
  /** True when no rule matched and the overview was used. */
  fallback: boolean;
  /** Collection-improvement percentage for scenario questions (default 10). */
  scenarioPct: number;
  /** Filter narrowing found in the question text (region, channel, period). */
  filterOverrides: Partial<Filters>;
  interpretation: string[];
}

const MAX_ANALYSES = 4;

/** Specific analyses outrank general ones when more than MAX_ANALYSES match. */
const PRIORITY: AnalysisId[] = [
  "collection_scenario",
  "sales_vs_collections",
  "customer_concentration",
  "distributor_attention",
  "receivables_risk",
  "complaint_priorities",
  "complaint_patterns",
  "complaints",
  "forecast",
  "product_performance",
  "performance_drivers",
  "data_quality",
  "next_steps",
];

export function routeQuestion(question: string, model?: Model): RouteResult {
  const matched: RouteResult["matched"] = [];
  for (const rule of RULES) {
    const hit = rule.patterns.find((p) => p.test(question));
    if (hit) matched.push({ id: rule.id, pattern: hit.source });
  }
  let ids = matched.map((m) => m.id);

  // A "sales vs collections" question already covers drivers and receivables movement.
  if (ids.includes("sales_vs_collections")) ids = ids.filter((i) => i !== "performance_drivers");
  // "Which complaints may threaten retention" is about complaints, not the account health score.
  if (ids.includes("complaint_priorities") && !/distributor|health|account/i.test(question)) ids = ids.filter((i) => i !== "distributor_attention");
  // Scenario questions about something other than collections fall back to the scenario page.
  if (ids.includes("collection_scenario") && !/collect|overdue|receivabl|payment|recover/i.test(question)) {
    ids = ids.filter((i) => i !== "collection_scenario");
  }

  const interpretation: string[] = [];
  const fallback = ids.length === 0;
  if (fallback) {
    ids = ["next_steps"];
    interpretation.push("No specific analysis matched the question, so a management overview is shown. Try naming a topic such as overdue balances, distributors, products or complaints.");
  }
  ids.sort((a, b) => PRIORITY.indexOf(a) - PRIORITY.indexOf(b));
  ids = ids.slice(0, MAX_ANALYSES);

  const pctMatch = /(\d{1,2}(?:\.\d+)?)\s?(%|percent)/i.exec(question);
  const scenarioPct = pctMatch ? Math.min(100, Number(pctMatch[1])) : 10;

  const filterOverrides: Partial<Filters> = {};
  if (model) {
    const mentioned = (values: string[]) => values.filter((v) => new RegExp(`\\b${v.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i").test(question));
    const regions = mentioned(model.regions);
    if (regions.length) {
      filterOverrides.regions = regions;
      interpretation.push(`Region filter from the question: ${regions.join(", ")}.`);
    }
    const channels = mentioned(model.channels);
    if (channels.length) {
      filterOverrides.channels = channels;
      interpretation.push(`Channel filter from the question: ${channels.join(", ")}.`);
    }
    const q = /\bQ([1-4])\s*(20\d{2})\b/i.exec(question) ?? /\b(20\d{2})\s*Q([1-4])\b/i.exec(question);
    if (q) {
      const [quarter, year] = /^Q/i.test(q[0]) ? [Number(q[1]), q[2]] : [Number(q[2]), q[1]];
      const sm = String((quarter - 1) * 3 + 1).padStart(2, "0");
      const em = String(quarter * 3).padStart(2, "0");
      filterOverrides.start = monthStart(`${year}-${sm}`);
      filterOverrides.end = monthEnd(`${year}-${em}`);
      interpretation.push(`Period from the question: Q${quarter} ${year}.`);
    } else {
      const y = /\b(?:in|during|for|of)\s+(20\d{2})\b/i.exec(question);
      if (y) {
        filterOverrides.start = `${y[1]}-01-01`;
        filterOverrides.end = `${y[1]}-12-31`;
        interpretation.push(`Period from the question: ${y[1]}.`);
      }
    }
  }

  return { analyses: ids, matched, fallback, scenarioPct, filterOverrides, interpretation };
}
