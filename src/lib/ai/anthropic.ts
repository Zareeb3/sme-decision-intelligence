/**
 * Minimal Anthropic Messages API client (server-side only).
 *
 * Uses fetch directly instead of an SDK to keep dependencies small and the
 * request easy to read. The API key is read from the environment and is never
 * sent to the browser.
 */
import { buildUserMessage, SUBMIT_TOOL, SYSTEM_PROMPT } from "./prompt";
import { analystResponseSchema, type AnalystResponse, type EvidencePacket } from "./types";

export const DEFAULT_MODEL = "claude-sonnet-5-5";
const API_URL = "https://api.anthropic.com/v1/messages";
const API_VERSION = "2023-06-01";

export interface LlmConfig {
  apiKey: string;
  model: string;
  timeoutMs: number;
}

export function readLlmConfig(env: Record<string, string | undefined> = process.env): LlmConfig | null {
  const apiKey = env.ANTHROPIC_API_KEY?.trim();
  if (!apiKey) return null;
  return { apiKey, model: env.ANTHROPIC_MODEL?.trim() || DEFAULT_MODEL, timeoutMs: Number(env.LLM_TIMEOUT_MS) || 45_000 };
}

export class LlmError extends Error {
  constructor(message: string, readonly status?: number) {
    super(message);
  }
}

interface ToolUseBlock {
  type: "tool_use";
  name: string;
  input: unknown;
}

export interface ToolDefinition {
  name: string;
  description: string;
  input_schema: Record<string, unknown>;
}

/**
 * One Messages API call that forces the model to answer through `tool`
 * (structured output). Returns the tool input, unvalidated; callers validate it.
 * Timeouts, network errors, HTTP errors and missing tool output become LlmError.
 */
export async function callTool(
  req: { system: string; tool: ToolDefinition; user: string; maxTokens: number },
  cfg: LlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ input: unknown; usage?: { input_tokens: number; output_tokens: number } }> {
  const ctrl = new AbortController();
  const timer = setTimeout(() => ctrl.abort(), cfg.timeoutMs);
  let res: Response;
  try {
    res = await fetchImpl(API_URL, {
      method: "POST",
      signal: ctrl.signal,
      headers: {
        "content-type": "application/json",
        "x-api-key": cfg.apiKey,
        "anthropic-version": API_VERSION,
      },
      body: JSON.stringify({
        model: cfg.model,
        max_tokens: req.maxTokens,
        temperature: 0,
        system: req.system,
        tools: [req.tool],
        tool_choice: { type: "tool", name: req.tool.name },
        messages: [{ role: "user", content: req.user }],
      }),
    });
  } catch (e) {
    throw new LlmError(ctrl.signal.aborted ? `The AI provider did not respond within ${cfg.timeoutMs / 1000} seconds.` : `Could not reach the AI provider: ${(e as Error).message}`);
  } finally {
    clearTimeout(timer);
  }

  if (!res.ok) {
    const body = await res.text().catch(() => "");
    const hint = res.status === 401 ? " Check ANTHROPIC_API_KEY." : res.status === 404 ? " Check ANTHROPIC_MODEL." : res.status === 429 ? " Rate limit reached; try again shortly." : res.status === 529 || res.status >= 500 ? " The provider is busy or unavailable; try again shortly." : "";
    throw new LlmError(`AI provider returned HTTP ${res.status}.${hint} ${body.slice(0, 200)}`.trim(), res.status);
  }

  let json: { content?: unknown[]; usage?: { input_tokens: number; output_tokens: number } };
  try {
    json = (await res.json()) as typeof json;
  } catch {
    throw new LlmError("The AI provider returned a response that is not valid JSON.");
  }
  const block = (json.content ?? []).find((b): b is ToolUseBlock => (b as ToolUseBlock)?.type === "tool_use" && (b as ToolUseBlock).name === req.tool.name);
  if (!block) throw new LlmError("The AI response did not contain the expected structured output.");
  return { input: block.input, usage: json.usage };
}

export async function explainWithClaude(
  packet: EvidencePacket,
  cfg: LlmConfig,
  fetchImpl: typeof fetch = fetch,
): Promise<{ response: AnalystResponse; usage?: { input_tokens: number; output_tokens: number } }> {
  const { input, usage } = await callTool({ system: SYSTEM_PROMPT, tool: SUBMIT_TOOL as ToolDefinition, user: buildUserMessage(packet), maxTokens: 2000 }, cfg, fetchImpl);
  const parsed = analystResponseSchema.safeParse(input);
  if (!parsed.success) {
    throw new LlmError(`The AI response did not match the expected structure: ${parsed.error.issues.slice(0, 3).map((i) => `${i.path.join(".")} ${i.message}`).join("; ")}`);
  }
  return { response: parsed.data, usage };
}
