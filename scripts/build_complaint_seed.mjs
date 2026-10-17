// Builds public/sample-data/complaint_texts.json (the sample complaint register seed)
// from evals/complaint_triage.json, so the demo and the evaluation use identical texts.
// The reviewer's decision in the seed is the expected label from the evaluation set.
import { readFileSync, writeFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";

const root = join(dirname(fileURLToPath(import.meta.url)), "..");
const src = JSON.parse(readFileSync(join(root, "evals/complaint_triage.json"), "utf8"));
const out = {
  description: "Synthetic complaint texts for the sample company's complaint register (fictional). Generated from evals/complaint_triage.json by scripts/build_complaint_seed.mjs; do not edit by hand.",
  cases: src.cases.map((c) => ({
    id: c.id,
    linkedComplaintId: c.linkedComplaintId ?? null,
    customerId: c.customerId ?? null,
    customerNameEntered: c.customerNameEntered ?? "",
    orderRef: c.orderRef ?? null,
    claimValue: c.claimValue ?? null,
    contactName: c.contactName ?? "",
    receivedDate: c.receivedDate,
    channel: c.channel,
    text: c.text,
    flow: c.flow,
    reviewerDecision: { category: c.expected.category, department: c.expected.department, priority: c.expected.priority },
  })),
};
writeFileSync(join(root, "public/sample-data/complaint_texts.json"), JSON.stringify(out, null, 1) + "\n");
console.log(`wrote ${out.cases.length} sample complaint texts`);
