/**
 * POST /api/ask
 * Body: { packet: EvidencePacket }
 *
 * The browser computes the evidence packet from the currently loaded data
 * (so uploaded CSVs never need to leave the browser in full). This route
 * validates the packet, calls the LLM server-side (the API key stays here),
 * validates the structured answer and runs the grounding check.
 */
import { NextResponse } from "next/server";
import { answerFromEvidence } from "@/lib/ai/ask";
import { evidencePacketSchema } from "@/lib/ai/types";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BODY_BYTES = 60_000;

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`ask:${ip}`, 20, 60_000)) {
    return NextResponse.json({ error: "Too many questions in a short time. Wait a minute and try again." }, { status: 429 });
  }

  const text = await req.text();
  if (text.length > MAX_BODY_BYTES) {
    return NextResponse.json({ error: "Request too large. Narrow the filters or ask a more specific question." }, { status: 413 });
  }
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ error: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = evidencePacketSchema.safeParse((body as { packet?: unknown })?.packet);
  if (!parsed.success) {
    return NextResponse.json({ error: "Invalid evidence packet.", details: parsed.error.issues.slice(0, 5) }, { status: 400 });
  }

  const result = await answerFromEvidence(parsed.data);
  return NextResponse.json(result);
}
