import { LlmError } from "./llm";
import { ExtractionError } from "./extract";

export class SetupError extends Error {}
// A mistake in how a command was typed: the message already says how to fix it.
export class UsageError extends Error {}

// Every message names a runbook entry (README.md → Runbook) so a non-technical operator can act on it.
export function explainError(err: unknown): string {
  if (err instanceof SetupError) return `${err.message} (runbook: 'Setup')`;
  if (err instanceof UsageError) return err.message;
  if (err instanceof LlmError && (err.status === 401 || err.status === 403)) {
    return "The AI provider rejected our API key. Check OPENROUTER_API_KEY (runbook: 'AI key rejected').";
  }
  if (err instanceof LlmError && (err.status === 402 || err.status === 429)) {
    return "The AI provider is rate-limiting us or the account is out of credit. Wait 5 minutes and retry, or top up credit (runbook: 'Out of credit').";
  }
  if (err instanceof LlmError && err.status === 408) {
    return "The AI model took too long to answer. Free models can be slow; retry, or switch to the paid route in config/models.json (runbook: 'AI provider down').";
  }
  if (err instanceof LlmError && err.status === 0) {
    return "Couldn't reach the AI provider. Check the internet connection and retry (runbook: 'AI provider down').";
  }
  if (err instanceof LlmError && (err.status === 400 || err.status === 404)) {
    return `The AI provider rejected the request (status ${err.status}): ${err.message.slice(0, 150)}. Often the model name in config/models.json is wrong or the model doesn't support JSON output (runbook: 'AI provider down').`;
  }
  if (err instanceof LlmError) {
    return `The AI provider had a problem (status ${err.status}). Retry in a few minutes (runbook: 'AI provider down').`;
  }
  if (err instanceof ExtractionError) {
    return `The AI's answer couldn't be turned into tasks. Retry once; if it fails again, the note may be too long or unclear (runbook: 'Bad AI answer'). Details: ${err.message}`;
  }
  const code = (err as { code?: string } | null)?.code;
  if (code === "object_not_found" || code === "unauthorized" || code === "restricted_resource") {
    return "Notion refused access to the Tasks database. Make sure the 'Ops Brain' connection is added to it (runbook: 'Notion access').";
  }
  if (code === "validation_error") {
    return "The Notion Tasks database is missing a property or one has the wrong type, e.g. Status must be a Select (runbook: 'Notion access').";
  }
  const detail = ((err as Error | null)?.message ?? String(err)).replace(/\.$/, "");
  return `Something unexpected went wrong: ${detail}. Send this message to the system owner.`;
}

export async function postAlert(webhookUrl: string | undefined, message: string, fetchFn: typeof fetch = fetch): Promise<void> {
  if (!webhookUrl) return;
  await fetchFn(webhookUrl, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ text: `:rotating_light: Ops Brain: ${message}` }),
  });
}
