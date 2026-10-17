/**
 * GET /api/settings -> company settings stored on the server (or null)
 * PUT /api/settings -> save company settings (validated)
 */
import { NextResponse } from "next/server";
import { Storage } from "@/lib/server/storage";
import { companySettingsSchema } from "@/lib/settings";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const storage = Storage.fromEnv();
  return NextResponse.json({ settings: storage ? await storage.readSettings() : null, stored: Boolean(storage) });
}

export async function PUT(req: Request) {
  const storage = Storage.fromEnv();
  if (!storage) return NextResponse.json({ ok: false, message: "Server storage is not enabled; settings are kept in this browser." }, { status: 400 });
  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, message: "Body must be JSON." }, { status: 400 });
  }
  const parsed = companySettingsSchema.safeParse(body);
  if (!parsed.success) return NextResponse.json({ ok: false, message: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") }, { status: 400 });
  await storage.saveSettings(parsed.data);
  return NextResponse.json({ ok: true });
}
