/**
 * GET  /api/complaints/cases   -> { cases }           complaint register on this server
 * POST /api/complaints/cases   -> 201 { case }        record a new complaint (NewCaseInput)
 *
 * Available when server storage is enabled. Protected by the app sign-in when configured.
 */
import { NextResponse } from "next/server";
import { Storage } from "@/lib/server/storage";
import { createCaseOnServer, listCases, workflowStatus } from "@/lib/server/caseStore";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const noStorage = () => NextResponse.json({ ok: false, message: "Server storage is not enabled on this deployment; complaints are kept in the browser." }, { status: 400 });

export async function GET() {
  const storage = Storage.fromEnv();
  if (!storage) return noStorage();
  return NextResponse.json({ ok: true, cases: await listCases(storage) }, { headers: { "cache-control": "no-store" } });
}

export async function POST(req: Request) {
  const storage = Storage.fromEnv();
  if (!storage) return noStorage();
  if (!rateLimit(`case-create:${req.headers.get("x-forwarded-for") ?? "local"}`, 60, 60_000)) return NextResponse.json({ ok: false, message: "Too many submissions; wait a minute." }, { status: 429 });
  const text = await req.text();
  if (text.length > 20_000) return NextResponse.json({ ok: false, message: "Complaint too large." }, { status: 413 });
  let body: unknown;
  try {
    body = JSON.parse(text);
  } catch {
    return NextResponse.json({ ok: false, message: "Request body must be JSON." }, { status: 400 });
  }
  try {
    const created = await createCaseOnServer(storage, body as never);
    return NextResponse.json({ ok: true, case: created }, { status: 201 });
  } catch (e) {
    return NextResponse.json({ ok: false, message: (e as Error).message }, { status: workflowStatus(e) });
  }
}
