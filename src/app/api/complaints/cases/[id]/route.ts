/**
 * PATCH /api/complaints/cases/:id   body { action: CaseAction, expectedVersion: number }
 *
 * Every change to a case goes through the shared workflow rules (named person,
 * allowed transitions, confirmation before work starts, version check).
 * 400 invalid, 403 not allowed in this state, 404 unknown case, 409 changed by someone else.
 */
import { NextResponse } from "next/server";
import { Storage } from "@/lib/server/storage";
import { actOnServer, workflowStatus } from "@/lib/server/caseStore";
import { caseActionSchema } from "@/lib/complaints/types";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ id: string }> };

export async function PATCH(req: Request, ctx: Ctx) {
  const { id } = await ctx.params;
  const storage = Storage.fromEnv();
  if (!storage) return NextResponse.json({ ok: false, message: "Server storage is not enabled on this deployment." }, { status: 400 });
  if (!rateLimit(`case-act:${req.headers.get("x-forwarded-for") ?? "local"}`, 120, 60_000)) return NextResponse.json({ ok: false, message: "Too many changes; wait a minute." }, { status: 429 });
  const text = await req.text();
  if (text.length > 60_000) return NextResponse.json({ ok: false, message: "Request too large." }, { status: 413 });
  let body: { action?: unknown; expectedVersion?: unknown };
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, message: "Request body must be JSON." }, { status: 400 });
  }
  const parsed = caseActionSchema.safeParse(body.action);
  if (!parsed.success) return NextResponse.json({ ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")} ${i.message}`).join("; ") }, { status: 400 });
  const expected = typeof body.expectedVersion === "number" ? body.expectedVersion : null;
  try {
    const updated = await actOnServer(storage, decodeURIComponent(id), parsed.data, expected);
    return NextResponse.json({ ok: true, case: updated });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: workflowStatus(e) });
  }
}
