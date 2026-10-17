/**
 * Rule-based triage used when no AI provider is configured or the AI call fails.
 *
 * Keyword scoring per category, a small sentiment lexicon and fixed reply
 * templates. It is transparent and predictable but much less capable than a
 * language model: it misses paraphrases, sarcasm and mixed issues. Results are
 * always labelled "Rule-based suggestion — no AI model was called".
 */
import { INJECTION_PATTERN, LEGAL_PATTERN, RETENTION_PATTERN, SAFETY_PATTERN } from "./rules";
import { defaultDepartment, UNCLEAR_CATEGORY, type Taxonomy } from "./taxonomy";
import type { Priority, TriageAssessment } from "./types";
import type { TriageRequest } from "./llm";

const KEYWORDS: Record<string, RegExp[]> = {
  "Shade Variation": [/\bshades?\b/i, /\b(colou?r|tone)s?\b[^.]{0,40}\b(differ\w*|mismatch\w*|vary|varies|variation|not (?:the )?same|uneven)/i, /\b(differ\w*|mismatch\w*|two|different)\b[^.]{0,30}\b(colou?rs?|tones?|batch(?:es)?)\b/i, /\b(lighter|darker)\b/i, /\bnot matching\b/i, /\brang\b/i],
  "Surface Defect": [/\bpin ?holes?\b/i, /\bglaze\b/i, /\bscratch\w*/i, /\b(spots?|stains?|blemish\w*|bubbles?|crazing|hairline)\b/i, /\bsurface\b/i, /\bprint\w*\b[^.]{0,30}\b(defect|faded|blur\w*|missing)/i, /\bpolish\w*\b[^.]{0,30}\b(dull|gone|uneven|patch\w*)/i],
  "Size / Calibration": [/\b(size|sizes|sizing|calibrat\w*|thickness|dimension\w*)\b/i, /\bwarp\w*/i, /\b(not flat|uneven edges|lippage|bow(?:ed|ing))\b/i, /\b(not square|edges? (?:are )?not straight)\b/i, /\b\d+(?:\.\d+)?\s?mm\b/i],
  "Breakage in Transit": [/\bbroken\b/i, /\bbreak(?:age|ages)\b/i, /\b(chipped|smashed|shattered)\b/i, /\bcrack\w*\b[^.]{0,40}\b(arriv\w*|box\w*|deliver\w*|unload\w*|transit|truck)/i, /\bdamaged\b[^.]{0,30}\b(transit|deliver\w*|truck|unload\w*|arriv\w*)/i, /\btoot\w*/i],
  "Delivery Delay": [/\b(late|delay\w*)\b/i, /\bnot (?:yet )?(?:been )?(?:delivered|arrived|dispatched)\b/i, /\b(still waiting|has not arrived|hasn't arrived|no delivery)\b/i, /\bpromised\b[^.]{0,40}\b(date|delivery|by)\b/i, /\bdair\b/i],
  "Short Supply": [/\bshort(?:age| supply| supplied|fall)?\b/i, /\b(missing|fewer|less)\b[^.]{0,30}\b(boxes|cartons|pallets?|sqm|quantity|pieces)\b/i, /\bonly (?:received|got|delivered)\b/i, /\bwrong (?:item|product|design|tiles?|size|colou?r) (?:was )?(?:delivered|sent|supplied)/i, /\b(boxes|cartons)\b[^.]{0,30}\b(missing|short)\b/i],
  "Billing Discrepancy": [/\b(invoice[ds]?|billed|billing|overcharg\w*)\b/i, /\b(price|rate|discount)\b[^.]{0,40}\b(differ\w*|wrong|not (?:applied|given)|higher|agreed)\b/i, /\b(gst|sales tax|tax)\b[^.]{0,20}\b(wrong|charged|incorrect)\b/i, /\bcharged\b/i],
  "Payment / Credit Note": [/\bcredit note\b/i, /\brefund\w*/i, /\bpayment\b[^.]{0,40}\b(not (?:adjusted|applied|reflected|posted)|missing|adjust\w*)\b/i, /\b(ledger|account statement|statement of account|reconcil\w*|cheque)\b/i],
  "Product Safety": [SAFETY_PATTERN],
  "Installation / Usage": [/\b(grout\w*|install\w*|laying|layed|laid wrong|adhesive|mason|fixing|fitter|tiler)\b/i, /\b(clean\w*|acid|maintenance)\b/i, /\bhow (?:to|do we|should)\b/i],
  "Sales & Service Conduct": [/\b(rude|behaviou?r|attitude|unprofessional|disrespect\w*)\b/i, /\b(sales ?(?:man|person|rep\w*|officer)|area manager|your staff|your team)\b/i, /\b(no (?:response|reply|one (?:called|responded))|not (?:answering|responding|returning)|ignored|no call ?back)\b/i, /\b(promised|commitment)\b[^.]{0,40}\b(not|never|broke\w*)\b/i],
};

const NEGATIVE = /\b(disappoint\w*|unacceptable|worst|angry|fed up|terrible|pathetic|frustrat\w*|again|third time|shame\w*|cheat\w*|nonsense|useless|horrible|ridiculous|furious|disgust\w*|never again|fraud)\b/gi;
const POSITIVE = /\b(thank\w*|appreciate\w*|good (?:service|quality)|happy|satisfied)\b/gi;

const SEVERITY_BASE: Record<string, TriageAssessment["severity"]> = {
  "Shade Variation": "Medium",
  "Surface Defect": "Medium",
  "Size / Calibration": "Medium",
  "Breakage in Transit": "Medium",
  "Delivery Delay": "Medium",
  "Short Supply": "Medium",
  "Billing Discrepancy": "Medium",
  "Payment / Credit Note": "Medium",
  "Product Safety": "Critical",
  "Installation / Usage": "Low",
  "Sales & Service Conduct": "Low",
  [UNCLEAR_CATEGORY]: "Low",
};

const ACTIONS: Record<string, string[]> = {
  "Shade Variation": ["Ask for photos of the tiles laid side by side and the shade and batch codes from the box labels.", "Check dispatch records for mixed batches on this order.", "Hold the remaining stock of the batch until Quality confirms."],
  "Surface Defect": ["Ask for close-up photos and the batch code.", "Quality to inspect retained samples from the same batch.", "Decide on replacement only after inspection."],
  "Size / Calibration": ["Ask for measurements of several tiles and the batch code.", "Production to check calibration records for the batch.", "Advise the customer to stop laying until checked."],
  "Breakage in Transit": ["Ask for photos of the damaged boxes and the delivery note signed on receipt.", "Logistics to check loading and transporter records.", "Agree the quantity affected with the customer."],
  "Delivery Delay": ["Confirm the dispatch status and a realistic delivery date with Logistics.", "Inform the customer of the confirmed date.", "Check whether other orders on the same route are affected."],
  "Short Supply": ["Compare the delivery note, invoice and loading slip quantities.", "Confirm the shortfall with the warehouse.", "Arrange the balance or a correction once confirmed."],
  "Billing Discrepancy": ["Compare the invoice with the agreed price list, discount and order confirmation.", "Commercial to confirm whether a correction is due.", "Respond with the reconciliation."],
  "Payment / Credit Note": ["Finance to check the customer ledger and pending credit notes.", "Share a statement of account with the customer.", "Correct the posting if an error is confirmed."],
  "Product Safety": ["Contact the customer today to understand what happened and whether anyone needs help.", "Quality and management to review immediately; preserve samples and evidence.", "Do not admit liability or promise compensation before review."],
  "Installation / Usage": ["Share the installation and maintenance guidance for the product.", "Offer a technical visit if the problem continues.", "Check whether the product itself is defective before closing."],
  "Sales & Service Conduct": ["Sales manager to call the customer and listen to the full account.", "Review the interaction with the staff member involved.", "Agree a single point of contact for follow-up."],
  [UNCLEAR_CATEGORY]: ["Call the customer to clarify what the problem is.", "Ask for the order or invoice number and photos.", "Re-run triage once the details are known."],
};

const HOURS: Record<Priority, number> = { Critical: 24, High: 48, Medium: 120, Low: 240 };

function scoreCategories(text: string, tax: Taxonomy) {
  const scores = new Map<string, number>();
  for (const c of tax.categories) {
    const pats = KEYWORDS[c.name] ?? [new RegExp(`\\b${c.name.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}\\b`, "i")];
    const n = pats.filter((p) => p.test(text)).length;
    if (n) scores.set(c.name, n);
  }
  return [...scores.entries()].sort((a, b) => b[1] - a[1]);
}

export function ruleBasedAssessment(req: TriageRequest, tax: Taxonomy): TriageAssessment {
  const text = req.text;
  const words = text.split(/\s+/).filter(Boolean);
  const ranked = scoreCategories(text, tax);
  // Safety always wins: a calmly worded injury report must not be filed as a defect.
  const safety = SAFETY_PATTERN.test(text);
  let primary = safety ? "Product Safety" : (ranked[0]?.[0] ?? UNCLEAR_CATEGORY);
  const secondaryEntry = ranked.find(([c]) => c !== primary);
  const top = ranked.find(([c]) => c === primary)?.[1] ?? 0;
  if (!safety && (words.length < 6 || top === 0)) primary = UNCLEAR_CATEGORY;
  const secondary = primary === UNCLEAR_CATEGORY ? null : (secondaryEntry?.[0] ?? null);

  const neg = (text.match(NEGATIVE) ?? []).length;
  const pos = (text.match(POSITIVE) ?? []).length;
  const exclaim = (text.match(/!/g) ?? []).length;
  const capsWords = words.filter((w) => w.length > 3 && /^[A-Z]+[!.,]*$/.test(w)).length;
  const sentiment: TriageAssessment["sentiment"] = neg >= 3 || capsWords >= 3 || exclaim >= 4 ? "Very negative" : neg >= 1 || exclaim >= 2 ? "Negative" : pos > 0 && neg === 0 ? "Positive" : "Neutral";
  const frustration: TriageAssessment["frustration"] = sentiment === "Very negative" || /\b(again|third time|repeated(?:ly)?|still)\b/i.test(text) ? "High" : sentiment === "Negative" ? "Medium" : "Low";

  let severity = SEVERITY_BASE[primary] ?? "Medium";
  const largeScope = /\b(entire|whole|all (?:the )?(?:boxes|tiles|cartons)|every box|complete (?:order|consignment)|(?:[5-9]\d{2}|\d{4,})\s?(?:sqm|m2|square met\w*)|\d{2,}\s?(?:boxes|cartons|pallets))\b/i.test(text);
  const installed = /\b(already (?:laid|installed|fixed)|after (?:laying|installation)|on (?:the )?(?:floor|wall)s? now)\b/i.test(text);
  const siteStopped = /\b(site (?:is )?(?:stopped|idle|waiting)|labou?r (?:is )?(?:waiting|idle|sitting)|work (?:has )?stopped|handover|deadline|project (?:is )?(?:delayed|stuck))\b/i.test(text);
  if (severity === "Medium" && (largeScope || installed || siteStopped)) severity = "High";
  if (severity === "Medium" && /\b(one|two|a few|1|2|3) (?:tiles?|boxes|pieces)\b/i.test(text) && !largeScope) severity = "Low";

  const priority: Priority = severity;
  const urgency: TriageAssessment["urgency"] = priority === "Critical" ? "Immediate" : priority === "High" ? "High" : priority === "Medium" ? "Medium" : "Low";
  const department = defaultDepartment(primary, tax);

  const missing: string[] = [];
  if (!req.references.order) missing.push("Order, delivery note or invoice number");
  if (["Shade Variation", "Surface Defect", "Size / Calibration", "Breakage in Transit", "Product Safety"].includes(primary)) missing.push("Photos of the affected tiles and the box labels (batch and shade codes)");
  if (!/\b\d+\s?(?:sqm|m2|square met\w*|boxes|cartons|pieces|tiles)\b/i.test(text) && primary !== UNCLEAR_CATEGORY && primary !== "Sales & Service Conduct") missing.push("Quantity affected");
  if (primary === UNCLEAR_CATEGORY) missing.unshift("What exactly is wrong (product, problem and when it was noticed)");
  if (primary === "Product Safety") missing.push("What happened, when, and whether anyone needed medical attention");

  const injection = INJECTION_PATTERN.test(text);
  const escalate = safety || LEGAL_PATTERN.test(text) || RETENTION_PATTERN.test(text);
  const firstSentence = (text.split(/(?<=[.!?])\s+/)[0] ?? text).slice(0, 220);
  const issueLabel = primary === UNCLEAR_CATEGORY ? "an unclear issue" : primary.toLowerCase();
  const confidence: TriageAssessment["confidence"] =
    primary === UNCLEAR_CATEGORY ? "Low" : safety || (top >= 2 && (!secondaryEntry || top >= 2 * secondaryEntry[1])) ? "High" : "Medium";

  return {
    primary_category: primary,
    secondary_category: secondary,
    issues: [primary === UNCLEAR_CATEGORY ? "Problem not clearly described" : primary, ...(secondary ? [secondary] : [])],
    summary: `Customer reports ${issueLabel}${req.product ? ` on ${req.product.name}` : ""}. "${firstSentence}${firstSentence.length < text.length ? "…" : ""}"`.slice(0, 500),
    sentiment,
    frustration,
    severity,
    business_impact:
      primary === "Product Safety"
        ? "Possible risk to people and liability exposure; needs immediate review."
        : severity === "High"
          ? "Large quantity, installed product or a stopped site: rework, replacement or relationship cost is likely."
          : severity === "Low"
            ? "Limited quantity or a service issue; low direct cost if handled promptly."
            : "Moderate cost and relationship impact if not resolved promptly.",
    urgency,
    response_within_hours: HOURS[priority],
    priority,
    department,
    next_actions: ACTIONS[primary] ?? ACTIONS[UNCLEAR_CATEGORY],
    customer_response: `Thank you for letting us know about ${issueLabel}${req.product ? ` with ${req.product.name}` : ""}, and we are sorry for the trouble this has caused. Your complaint has been registered and our ${department} team will review it. ${missing.length ? `To investigate, please share: ${missing.join("; ").toLowerCase()}. ` : ""}We will contact you with the next steps once the review is complete.`,
    escalate,
    escalation_reason: escalate ? (safety ? "Possible safety risk." : "Legal or customer-retention risk mentioned.") : null,
    safety_concern: safety,
    confidence,
    confidence_reason:
      confidence === "Low"
        ? "Keyword rules found no clear match; the complaint needs a person to classify it."
        : confidence === "High"
          ? "Several keywords point to the same category with no strong competing match."
          : `Keywords suggest ${primary}${secondary ? `, but ${secondary} also matched` : " with limited evidence"}.`,
    missing_information: missing.slice(0, 6),
    embedded_instructions_detected: injection,
  };
}
