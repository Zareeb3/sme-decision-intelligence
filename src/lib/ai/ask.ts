/**
 * Server-side orchestration for one question. Shared by the API route and the
 * evaluation script so both behave identically.
 */
import { explainWithClaude, LlmError, readLlmConfig, type LlmConfig } from "./anthropic";
import { demoExplain } from "./demo";
import { checkGrounding } from "./grounding";
import type { AskResult, EvidencePacket } from "./types";

export async function answerFromEvidence(
  packet: EvidencePacket,
  opts: { config?: LlmConfig | null; fetchImpl?: typeof fetch } = {},
): Promise<AskResult> {
  const config = opts.config === undefined ? readLlmConfig() : opts.config;

  if (!config) {
    const response = demoExplain(packet);
    return {
      mode: "demo",
      response,
      grounding: checkGrounding(response, packet),
      notices: ["Demo mode: no AI provider is configured, so this explanation was written by fixed templates. No AI model was called."],
    };
  }

  try {
    const { response } = await explainWithClaude(packet, config, opts.fetchImpl);
    const grounding = checkGrounding(response, packet);
    const notices = grounding.grounded
      ? []
      : ["Some statements could not be verified against the evidence. They are marked below; rely on the evidence table for exact figures."];
    return { mode: "live", model: config.model, response, grounding, notices };
  } catch (e) {
    const message = e instanceof LlmError ? e.message : "Unexpected error while calling the AI provider.";
    const response = demoExplain(packet);
    return {
      mode: "demo",
      response,
      grounding: checkGrounding(response, packet),
      notices: [`The live AI call failed (${message}). Showing the demo-mode explanation instead; no AI output is included.`],
    };
  }
}
