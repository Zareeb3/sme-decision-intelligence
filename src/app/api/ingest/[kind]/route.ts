/**
 * POST /api/ingest/:kind?mode=replace|append
 *
 * Machine endpoint for data pipelines (SAP extract scripts, n8n, Power Automate,
 * any ETL tool). Authenticate with "Authorization: Bearer <INGEST_TOKEN>".
 * Body: CSV text (any column names the mapper recognises, canonical names
 * preferred) or JSON (an array of row objects, or {"rows": [...]}).
 *
 * The data is validated with the same rules as the app; a file with blocking
 * errors is rejected (HTTP 422) and the stored dataset is left unchanged.
 */
import { NextResponse } from "next/server";
import { Storage } from "@/lib/server/storage";
import { bearer, ingest, isDatasetKind, jsonToCsv, tokenMatches } from "@/lib/server/ingest";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

const MAX_BYTES = 100 * 1024 * 1024;

export async function POST(req: Request, ctx: { params: Promise<{ kind: string }> }) {
  const expected = process.env.INGEST_TOKEN?.trim();
  if (!expected) return NextResponse.json({ ok: false, message: "Ingest is disabled: set INGEST_TOKEN on the server." }, { status: 503 });
  if (!tokenMatches(bearer(req), expected)) return NextResponse.json({ ok: false, message: "Invalid or missing ingest token." }, { status: 401 });
  if (!rateLimit(`ingest:${req.headers.get("x-forwarded-for") ?? "local"}`, 120, 60_000)) return NextResponse.json({ ok: false, message: "Too many requests." }, { status: 429 });

  const { kind } = await ctx.params;
  if (!isDatasetKind(kind)) return NextResponse.json({ ok: false, message: `Unknown dataset "${kind}". Use orders, customers, invoices, payments, targets or complaints.` }, { status: 404 });
  const storage = Storage.fromEnv();
  if (!storage) return NextResponse.json({ ok: false, message: "Server storage is not enabled; set DATA_DIR." }, { status: 503 });

  const raw = await req.text();
  if (raw.length > MAX_BYTES) return NextResponse.json({ ok: false, message: "Body larger than 100 MB; split the load." }, { status: 413 });
  let text = raw;
  if ((req.headers.get("content-type") ?? "").includes("json")) {
    try {
      text = jsonToCsv(JSON.parse(raw));
    } catch (e) {
      return NextResponse.json({ ok: false, message: (e as Error).message }, { status: 400 });
    }
  }
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "append" ? "append" : "replace";
  const by = (req.headers.get("x-pipeline-name") ?? "pipeline").slice(0, 80);
  const outcome = await ingest(storage, kind, text, { mode, source: "pipeline", by });
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
}
