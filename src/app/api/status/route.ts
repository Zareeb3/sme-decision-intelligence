/**
 * GET /api/status — which optional integrations are configured.
 * Returns booleans and the model name only; never secrets.
 */
import { NextResponse } from "next/server";
import { readLlmConfig } from "@/lib/ai/anthropic";
import { sampleDataEnabled, storageStatus } from "@/lib/server/storage";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const llm = readLlmConfig();
  return NextResponse.json({
    llm: { configured: Boolean(llm), model: llm?.model ?? null, provider: "Anthropic" },
    n8n: { configured: Boolean(process.env.N8N_WEBHOOK_URL?.trim()) },
    storage: { enabled: storageStatus().enabled, reason: storageStatus().reason },
    ingest: { configured: Boolean(process.env.INGEST_TOKEN?.trim()) },
    auth: { enabled: Boolean(process.env.BASIC_AUTH_USER && process.env.BASIC_AUTH_PASSWORD) },
    sampleEnabled: sampleDataEnabled(),
  });
}
