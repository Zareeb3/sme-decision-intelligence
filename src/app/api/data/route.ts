/**
 * GET    /api/data  -> storage status, dataset manifest, sample-data flag.
 *                      Imports any files waiting in the drop folder first.
 * DELETE /api/data  -> remove all stored company datasets.
 */
import { NextResponse } from "next/server";
import { sampleDataEnabled, Storage, storageStatus } from "@/lib/server/storage";
import { importDropFolder } from "@/lib/server/ingest";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const status = storageStatus();
  const storage = Storage.fromEnv();
  let imported: Awaited<ReturnType<typeof importDropFolder>> = [];
  let manifest = {};
  if (storage) {
    try {
      imported = await importDropFolder(storage);
      manifest = await storage.readManifest();
    } catch (e) {
      return NextResponse.json({ storage: { ...status, enabled: false, reason: `Storage folder is not usable: ${(e as Error).message}` }, manifest: {}, sampleEnabled: sampleDataEnabled() });
    }
  }
  return NextResponse.json({
    storage: status,
    manifest,
    sampleEnabled: sampleDataEnabled(),
    ingestConfigured: Boolean(process.env.INGEST_TOKEN?.trim()),
    dropFolder: storage?.incomingDir ?? null,
    imported: imported.map((r) => ({ kind: r.kind, ok: r.ok, rows: r.rowsStored, errors: r.fileErrors })),
  });
}

export async function DELETE() {
  const storage = Storage.fromEnv();
  if (!storage) return NextResponse.json({ ok: false, message: "Server storage is not enabled on this deployment." }, { status: 400 });
  await storage.clearAll();
  return NextResponse.json({ ok: true, message: "All stored company datasets were removed." });
}
