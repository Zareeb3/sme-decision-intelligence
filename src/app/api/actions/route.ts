/**
 * POST /api/actions
 * Body: { action: ProposedAction, approval: { approved: true, approverName, note? } }
 *
 * Sends an approved action to the n8n webhook configured on the server.
 * - Without approval the request is rejected.
 * - Without N8N_WEBHOOK_URL nothing is sent; the response says so plainly.
 * - The destination URL comes only from server configuration, never from the
 *   request, so the endpoint cannot be used to call arbitrary URLs.
 */
import { NextResponse } from "next/server";
import { approvalRequestSchema } from "@/lib/actions";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const ip = req.headers.get("x-forwarded-for")?.split(",")[0]?.trim() || "local";
  if (!rateLimit(`actions:${ip}`, 30, 60_000)) {
    return NextResponse.json({ status: "error", message: "Too many requests. Wait a minute and try again." }, { status: 429 });
  }

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ status: "error", message: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = approvalRequestSchema.safeParse(body);
  if (!parsed.success) {
    const msg = parsed.error.issues.map((i) => i.message).join("; ");
    return NextResponse.json({ status: "rejected", message: `Not sent: ${msg}` }, { status: 400 });
  }

  const url = process.env.N8N_WEBHOOK_URL?.trim();
  if (!url) {
    return NextResponse.json({
      status: "not_sent",
      message: "Approved, but not sent: n8n is not configured (set N8N_WEBHOOK_URL on the server). The payload below is what would be sent.",
    });
  }

  const { action, approval } = parsed.data;
  const envelope = {
    source: "sme-decision-intelligence",
    sent_at: new Date().toISOString(),
    action_id: action.id,
    action_type: action.type,
    title: action.title,
    recipient: action.recipient,
    reason: action.reason,
    approved_by: approval.approverName,
    approval_note: approval.note ?? "",
    payload: action.payload,
  };

  try {
    const res = await fetch(url, {
      method: "POST",
      headers: {
        "content-type": "application/json",
        ...(process.env.N8N_WEBHOOK_SECRET ? { "x-webhook-secret": process.env.N8N_WEBHOOK_SECRET } : {}),
      },
      body: JSON.stringify(envelope),
      signal: AbortSignal.timeout(15_000),
    });
    if (!res.ok) {
      return NextResponse.json({ status: "error", message: `n8n responded with HTTP ${res.status}. Check that the workflow is active.` }, { status: 502 });
    }
    return NextResponse.json({ status: "sent", message: `Sent to n8n and accepted (HTTP ${res.status}).` });
  } catch (e) {
    return NextResponse.json({ status: "error", message: `Could not reach n8n: ${(e as Error).message}` }, { status: 502 });
  }
}
