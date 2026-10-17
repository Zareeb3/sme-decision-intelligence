/**
 * POST /api/complaints/triage
 * Body: TriageRequest (complaint text already redacted in the browser, plus minimal context).
 *
 * Stateless: returns a validated assessment (live AI or the labelled rule-based
 * fallback). It does not change any case; recording the assessment and every
 * decision after it goes through the case workflow.
 */
import { NextResponse } from "next/server";
import { runTriage, taxonomyFromRequest, triageRequestSchema } from "@/lib/complaints/llm";
import { buildTaxonomy } from "@/lib/complaints/taxonomy";
import { redactForAI } from "@/lib/complaints/redact";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 30_000;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`triage:${ip}`, 30, 60_000)) {
    return NextResponse.json({ error: "Too many triage requests in a short time. Wait a minute and retry." }, { status: 429 });
  }
  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) return NextResponse.json({ error: "Complaint too long for automatic triage." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = triageRequestSchema.safeParse(body);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid triage request.", details: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }
  // Defence in depth: redact contact details again on the server before anything leaves it.
  const request = { ...parsed.data, text: redactForAI(parsed.data.text).text, supportingInfo: redactForAI(parsed.data.supportingInfo).text };
  const result = await runTriage(request, taxonomyFromRequest(request, buildTaxonomy()));
  return NextResponse.json(result);
}
