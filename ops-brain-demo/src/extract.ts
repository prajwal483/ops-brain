import { ExtractionSchema, type Extraction, type MeetingContext } from "./schema";
import { renderPrompt, type ModelRoute, type PromptConfig } from "./config";
import { LlmError, type LlmClient, type LlmUsage } from "./llm";

export type ExtractionUsage = LlmUsage;

export class ExtractionError extends Error {
  constructor(message: string, public usage: ExtractionUsage) {
    super(message);
  }
}

export interface ExtractionResult {
  extraction: Extraction;
  inputTokens: number;
  outputTokens: number;
  model: string;
  attempts: number;
}

export function buildSystemPrompt(prompt: PromptConfig, ctx: MeetingContext): string {
  return renderPrompt(prompt.text, {
    meeting_date: `${ctx.meetingDate} (${new Date(`${ctx.meetingDate}T00:00:00Z`).toLocaleDateString("en-US", { weekday: "long", timeZone: "UTC" })})`,
    meeting_title: ctx.meetingTitle,
    team: ctx.team.map((m) => `- ${m.name}${m.aliases.length ? ` (also: ${m.aliases.join(", ")})` : ""}`).join("\n"),
    goals: ctx.goals.map((g) => `- ${g.id}: ${g.title}`).join("\n"),
    existing_tasks:
      ctx.existingTasks.map((t) => `- ${t.id}: ${t.title} (owner ${t.ownerId}, due ${t.due})`).join("\n") || "(none)",
  });
}

export function parseExtraction(text: string): { ok: true; value: Extraction } | { ok: false; error: string } {
  let cleaned = text.trim().replace(/^```(?:json)?\s*/i, "").replace(/\s*```$/, "");
  const first = cleaned.indexOf("{");
  const last = cleaned.lastIndexOf("}");
  if (first !== -1 && last > first) cleaned = cleaned.slice(first, last + 1);
  let json: unknown;
  try {
    json = JSON.parse(cleaned);
  } catch (e) {
    return { ok: false, error: `Not valid JSON: ${(e as Error).message}` };
  }
  const parsed = ExtractionSchema.safeParse(json);
  if (!parsed.success) {
    return { ok: false, error: parsed.error.issues.map((i) => `${i.path.join(".")}: ${i.message}`).join("; ") };
  }
  return { ok: true, value: parsed.data };
}

export async function extractTasks(
  note: string,
  ctx: MeetingContext,
  deps: { llm: LlmClient; route: ModelRoute; prompt: PromptConfig },
  maxAttempts = 2,
): Promise<ExtractionResult> {
  const system = buildSystemPrompt(deps.prompt, ctx);
  let user = note;
  let inputTokens = 0;
  let outputTokens = 0;
  let model = deps.route.model;
  let lastError = "";

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    let res;
    try {
      res = await deps.llm.complete({ model: deps.route.model, system, user });
    } catch (err) {
      // Keep the provider error (and its status) so callers pick the right runbook and back-off;
      // attach the spend of the earlier attempts so it still reaches the run log.
      if (attempt > 1 && err instanceof LlmError) err.usage = { model, attempts: attempt - 1, inputTokens, outputTokens };
      throw err;
    }
    inputTokens += res.inputTokens;
    outputTokens += res.outputTokens;
    model = res.model;
    const parsed = parseExtraction(res.text);
    if (parsed.ok) return { extraction: parsed.value, inputTokens, outputTokens, model, attempts: attempt };
    lastError = parsed.error;
    user = `${note}\n\n---\nYour previous answer was:\n${res.text.slice(0, 4000)}\n\nIt was rejected: ${parsed.error}\nReturn only the corrected JSON object.`;
  }
  throw new ExtractionError(`The AI's answer was not in the expected format after ${maxAttempts} tries (${lastError}).`, {
    model,
    attempts: maxAttempts,
    inputTokens,
    outputTokens,
  });
}
