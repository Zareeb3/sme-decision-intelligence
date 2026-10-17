/**
 * GET    /api/data/:kind            -> stored canonical CSV
 * PUT    /api/data/:kind?mode=      -> store a CSV from the upload screen (validated)
 * POST   /api/data/:kind?action=rollback -> restore the previous version
 * DELETE /api/data/:kind            -> remove the dataset
 *
 * Protected by the app's sign-in (middleware) when BASIC_AUTH_* is configured.
 */
import { NextResponse } from "next/server";
import { Storage } from "@/lib/server/storage";
import { ingest, isDatasetKind } from "@/lib/server/ingest";
import { rateLimit } from "@/lib/server/rateLimit";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

type Ctx = { params: Promise<{ kind: string }> };
const MAX_BYTES = 50 * 1024 * 1024;

async function resolve(ctx: Ctx) {
  const { kind } = await ctx.params;
  if (!isDatasetKind(kind)) return { error: NextResponse.json({ ok: false, message: `Unknown dataset "${kind}".` }, { status: 404 }) };
  const storage = Storage.fromEnv();
  if (!storage) return { error: NextResponse.json({ ok: false, message: "Server storage is not enabled on this deployment." }, { status: 400 }) };
  return { kind, storage };
}

export async function GET(_req: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  const text = await r.storage.readDataset(r.kind);
  if (text === null) return NextResponse.json({ ok: false, message: "No data stored for this dataset." }, { status: 404 });
  return new NextResponse(text, { headers: { "content-type": "text/csv; charset=utf-8", "cache-control": "no-store" } });
}

export async function PUT(req: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  if (!rateLimit(`upload:${req.headers.get("x-forwarded-for") ?? "local"}`, 60, 60_000)) return NextResponse.json({ ok: false, message: "Too many uploads; wait a minute." }, { status: 429 });
  if ((process.env.ALLOW_UI_UPLOADS ?? "true").toLowerCase() === "false") {
    return NextResponse.json({ ok: false, message: "Uploads from the browser are disabled; data arrives through the pipeline." }, { status: 403 });
  }
  const text = await req.text();
  if (text.length > MAX_BYTES) return NextResponse.json({ ok: false, message: "File larger than 50 MB." }, { status: 413 });
  const url = new URL(req.url);
  const mode = url.searchParams.get("mode") === "append" ? "append" : "replace";
  const by = (req.headers.get("x-uploaded-by") ?? "Upload screen").slice(0, 80);
  const outcome = await ingest(r.storage, r.kind, text, { mode, source: "upload", by });
  return NextResponse.json(outcome, { status: outcome.ok ? 200 : 422 });
}

export async function POST(req: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  if (new URL(req.url).searchParams.get("action") !== "rollback") return NextResponse.json({ ok: false, message: "Unknown action." }, { status: 400 });
  const ok = await r.storage.rollback(r.kind);
  return NextResponse.json({ ok, message: ok ? "Previous version restored." : "No previous version to restore." }, { status: ok ? 200 : 404 });
}

export async function DELETE(_req: Request, ctx: Ctx) {
  const r = await resolve(ctx);
  if ("error" in r) return r.error;
  await r.storage.deleteDataset(r.kind);
  return NextResponse.json({ ok: true });
}
