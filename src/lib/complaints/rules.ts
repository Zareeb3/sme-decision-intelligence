/**
 * Deterministic business rules for complaint triage.
 *
 * The AI suggests; these rules make sure high-risk cases are never under-rated.
 * Rules can only RAISE the priority and ADD an escalation — they never lower
 * what the AI suggested. Every rule that fires is shown to the reviewer with
 * its reason, and the thresholds are editable in Settings → Business rules.
 */
import { getRules, type BusinessRules } from "../settings";
import { canonicalLabel, defaultDepartment, UNCLEAR_CATEGORY, type Taxonomy } from "./taxonomy";
import { maxPriority, type Priority, type RuleHit, type RuleResult, type Suggestion, type TriageAssessment } from "./types";
import { containsPersonalData } from "./redact";

export const SAFETY_PATTERN =
  /\b(injur\w*|hurt|wound\w*|bleed\w*|hospital\w*|accident\w*|fell|fallen|falling (?:off|down|from)|fall (?:off|from)|slipp(?:ed|ing|ery)|tripp(?:ed|ing)|stumbl\w*|skid(?:ded|ding)|unsafe|danger\w*|hazard\w*|sharp edges?|cut (?:his|her|my|their|a)\b|fracture\w*|collaps\w*|came off the wall|detach\w* from the wall|fire|electric shock|child(?:ren)? (?:was|were|got)|elderly)\b/i;

export const LEGAL_PATTERN = /\b(lawyer|advocate|legal (?:notice|action)|consumer court|court|sue|suing|lawsuit|FIR|police complaint|compensation claim)\b/i;

export const RETENTION_PATTERN =
  /\b(stop (?:buying|ordering|dealing|working)|take (?:our|my) business elsewhere|switch(?:ing)? (?:to|supplier)|another supplier|competitor|cancel (?:all|our|future|the remaining) orders?|(?:will be|is) (?:our|the) last order|last time we (?:order|buy)|close (?:our|the) account|never (?:order|buy) again|end (?:our|the) (?:relationship|dealership|agreement))\b/i;

/** Text that tries to instruct the system rather than describe a problem. */
export const INJECTION_PATTERN =
  /(\bsystem\s*:|\byou are now\b|\b(?:admin|developer|god) mode\b|\bset (?:the )?(?:priority|severity|status) (?:to |as )?(?:low|medium|high|critical|resolved|closed)\b|<\/?complaint>|ignore (?:all |any |the )?(?:previous|prior|above|earlier) (?:instructions|rules|prompts?)|disregard (?:the|your|all) (?:instructions|rules)|system prompt|you are (?:now|an? )\s*(?:ai|assistant|model|gpt|claude)|as an ai|(?:set|mark|change|classify) (?:this|the) (?:complaint|case|ticket|priority)\b[^.]{0,40}\b(?:as|to) (?:low|resolved|closed|critical|high|medium)|approve (?:a |the |my )?(?:full )?refund|output (?:only|the following)|<\/?(?:system|assistant|instructions?)>|\bjailbreak\b)/i;

export interface RuleContext {
  text: string;
  claimValue: number | null;
  customerType: string | null;
  /** 1 = the company's largest customer by sales in the last 12 months. */
  customerSalesRank: number | null;
  /** Other complaints from the same customer within the repeat window (excluding this one). */
  priorCustomerComplaints: number;
  /** Of those, how many had the same category, excluding complaints about the same order (follow-ups, not repeats). */
  priorSameCategory: (category: string) => number;
  /** Complaints on the same product and category within the systemic window (excluding this one). */
  productCategoryCount: (category: string) => number;
  /** True when the product is flagged by the complaint-spike rule, mostly for this category. */
  productSpike: (category: string) => boolean;
  productName: string | null;
  /** True for categories that describe the product itself (owned by Quality or Production). */
  productRelated: (category: string) => boolean;
}

const KEY_ACCOUNT_TYPES = /key account|institution|project|corporate/i;

export function evaluateRules(ctx: RuleContext, category: string, rules: BusinessRules["complaints"] = getRules().complaints): RuleResult {
  const hits: RuleHit[] = [];
  const text = ctx.text;

  if (SAFETY_PATTERN.test(text) || category === "Product Safety") {
    const m = SAFETY_PATTERN.exec(text);
    hits.push({ id: "safety", label: "Possible safety risk", reason: m ? `The complaint mentions "${m[0]}". Any allegation of injury or risk to people needs immediate human review.` : "Classified as a product-safety complaint.", priorityFloor: "Critical", escalate: true, department: "Quality" });
  }
  const legal = LEGAL_PATTERN.exec(text);
  if (legal) hits.push({ id: "legal", label: "Legal exposure", reason: `The complaint mentions "${legal[0]}".`, priorityFloor: "High", escalate: true });
  const ret = RETENTION_PATTERN.exec(text);
  if (ret) hits.push({ id: "retention", label: "Customer retention risk", reason: `The customer signals they may stop buying ("${ret[0]}").`, priorityFloor: "High", escalate: true });

  if (ctx.claimValue != null && ctx.claimValue >= rules.highClaimValue) {
    hits.push({ id: "high_claim", label: "High claim value", reason: `Claim of ${Math.round(ctx.claimValue).toLocaleString("en-US")} is at or above the ${rules.highClaimValue.toLocaleString("en-US")} threshold.`, priorityFloor: "High" });
  }
  const isKey = (ctx.customerType && KEY_ACCOUNT_TYPES.test(ctx.customerType)) || (ctx.customerSalesRank != null && ctx.customerSalesRank <= 10);
  if (isKey) {
    hits.push({ id: "key_account", label: "Important account", reason: ctx.customerSalesRank != null && ctx.customerSalesRank <= 10 ? `Customer is number ${ctx.customerSalesRank} by sales over the last 12 months.` : `Customer type is ${ctx.customerType}.`, priorityFloor: "Medium" });
  }

  if (category && category !== UNCLEAR_CATEGORY) {
    const same = ctx.priorSameCategory(category);
    if (same + 1 >= rules.repeatMinCount) {
      hits.push({ id: "repeat_issue", label: "Repeated issue", reason: `This customer raised ${same} other ${category.toLowerCase()} complaint(s) in the last ${rules.repeatWindowDays} days.`, priorityFloor: "High" });
    }
  }
  if (!hits.some((h) => h.id === "repeat_issue") && ctx.priorCustomerComplaints + 1 >= rules.repeatMinCount) {
    hits.push({ id: "repeat_customer", label: "Repeat complainant", reason: `${ctx.priorCustomerComplaints} other complaint(s) from this customer in the last ${rules.repeatWindowDays} days.`, priorityFloor: "Medium" });
  }

  // Systemic: product-related categories only (owned by Quality or Production). Recurring delays or
  // billing issues are shown in management insights but are not treated as a product problem here.
  if (category && category !== UNCLEAR_CATEGORY && ctx.productName && ctx.productRelated(category)) {
    const n = ctx.productCategoryCount(category);
    const spike = ctx.productSpike(category);
    if (spike || n + 1 >= rules.systemicMinCount) {
      hits.push({
        id: "systemic",
        label: "Possible systemic issue",
        reason: spike
          ? `${ctx.productName} is flagged for an unusual rise in ${category.toLowerCase()} complaints.`
          : `${n + 1} ${category.toLowerCase()} complaints on ${ctx.productName} in the last ${rules.systemicWindowDays} days, including this one.`,
        priorityFloor: "High",
        escalate: true,
      });
    }
  }

  if (INJECTION_PATTERN.test(text)) {
    hits.push({ id: "embedded_instructions", label: "Contains instructions", reason: "The text contains wording addressed to the system (for example to change priority or ignore rules). It was treated as customer text only; review the classification manually." });
  }
  if (containsPersonalData(text)) {
    hits.push({ id: "personal_data", label: "Personal data in text", reason: "Contact details or identifiers were found; they are removed before the text is analysed or sent to any AI provider." });
  }

  let floor: Priority | null = null;
  for (const h of hits) if (h.priorityFloor) floor = floor ? maxPriority(floor, h.priorityFloor) : h.priorityFloor;
  const esc = hits.filter((h) => h.escalate);
  return {
    hits,
    priorityFloor: floor,
    escalate: esc.length > 0,
    escalationReasons: esc.map((h) => `${h.label}: ${h.reason}`),
    department: hits.find((h) => h.department)?.department ?? null,
  };
}

/**
 * Combine the assessment with the rules into the system's suggestion.
 * Category and department labels are checked against the allowed lists.
 */
export function combine(a: TriageAssessment, r: RuleResult, tax: Taxonomy): Suggestion {
  const allowedCats = tax.categories.map((c) => c.name);
  const category = canonicalLabel(a.primary_category, allowedCats) ?? UNCLEAR_CATEGORY;
  const secondary = canonicalLabel(a.secondary_category, allowedCats);
  const aiDept = canonicalLabel(a.department, tax.departments) ?? defaultDepartment(category, tax);
  const department = r.department ?? aiDept;

  const priority = r.priorityFloor ? maxPriority(a.priority, r.priorityFloor) : a.priority;
  const raisedBy = r.hits.filter((h) => h.priorityFloor && h.priorityFloor === priority && priority !== a.priority);
  const priorityExplanation =
    priority === a.priority
      ? `${a.priority} as assessed${r.priorityFloor ? `; business rules require at least ${r.priorityFloor}` : ""}.`
      : `Assessed as ${a.priority}, raised to ${priority} by business rule${raisedBy.length > 1 ? "s" : ""}: ${raisedBy.map((h) => h.label.toLowerCase()).join(", ")}.`;

  const reasons = [...r.escalationReasons];
  if (a.escalate && a.escalation_reason) reasons.unshift(`Assessment: ${a.escalation_reason}`);
  else if (a.escalate) reasons.unshift("Assessment recommends management attention.");
  return {
    category,
    secondaryCategory: secondary && secondary !== category ? secondary : null,
    priority,
    department,
    escalate: a.escalate || r.escalate,
    escalationReasons: reasons,
    priorityExplanation,
  };
}

export function slaHours(p: Priority, rules: BusinessRules["complaints"] = getRules().complaints): number {
  return p === "Critical" ? rules.slaCriticalHours : p === "High" ? rules.slaHighHours : p === "Medium" ? rules.slaMediumHours : rules.slaLowHours;
}
