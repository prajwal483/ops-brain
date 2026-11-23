import { describe, it, expect, vi } from "vitest";
import { SetupError, UsageError, explainError, postAlert } from "../src/alerts";
import { LlmError } from "../src/llm";
import { ExtractionError } from "../src/extract";

describe("explainError", () => {
  it("turns provider and Notion errors into plain language with a runbook pointer", () => {
    expect(explainError(new LlmError("x", 401))).toContain("runbook: 'AI key rejected'");
    expect(explainError(new LlmError("x", 429))).toContain("runbook: 'Out of credit'");
    expect(explainError(new LlmError("x", 503))).toContain("status 503");
    expect(explainError(new ExtractionError("bad", { model: "m", attempts: 2, inputTokens: 0, outputTokens: 0 }))).toContain("runbook: 'Bad AI answer'");
    expect(explainError(Object.assign(new Error("nope"), { code: "object_not_found" }))).toContain("runbook: 'Notion access'");
    expect(explainError(new Error("boom"))).toContain("Something unexpected went wrong: boom");
  });
});

describe("explainError edge cases", () => {
  it("explains setup errors without the unexpected fallback", () => {
    const msg = explainError(new SetupError("OPENROUTER_API_KEY is not set. Copy .env.example to .env and fill it in."));
    expect(msg).toContain("OPENROUTER_API_KEY is not set");
    expect(msg).toContain("runbook: 'Setup'");
    expect(msg).not.toContain("unexpected");
  });
  it("shows usage mistakes as-is, without the unexpected fallback", () => {
    expect(explainError(new UsageError("No decision for T2. Use --approve, --edit or --reject"))).toBe(
      "No decision for T2. Use --approve, --edit or --reject",
    );
  });
  it("does not double the period in the fallback", () => {
    expect(explainError(new Error("boom."))).not.toContain("..");
  });
  it("explains unreachable provider and bad model name", () => {
    expect(explainError(new LlmError("x", 0))).toContain("Couldn't reach the AI provider");
    const long = "y".repeat(300);
    const msg = explainError(new LlmError(long, 400));
    expect(msg).toContain("The AI provider rejected the request (status 400): " + "y".repeat(150) + ".");
    expect(msg).not.toContain("y".repeat(151));
    expect(msg).toContain("model name in config/models.json is wrong or the model doesn't support JSON output (runbook: 'AI provider down')");
    expect(explainError(new LlmError("no such model", 404))).toContain("(status 404): no such model.");
  });
  it("explains a timeout differently from a network failure", () => {
    const msg = explainError(new LlmError("The model took too long to answer", 408));
    expect(msg).toBe("The AI model took too long to answer. Free models can be slow; retry, or switch to the paid route in config/models.json (runbook: 'AI provider down').");
  });
  it("explains Notion validation errors", () => {
    const msg = explainError(Object.assign(new Error("v"), { code: "validation_error" }));
    expect(msg).toContain("Status must be a Select");
    expect(msg).toContain("runbook: 'Notion access'");
  });
});

describe("postAlert", () => {
  it("posts to the Slack webhook", async () => {
    const fetchFn = vi.fn(async () => new Response("ok"));
    await postAlert("https://hooks.slack.test/x", "Notion refused access", fetchFn as unknown as typeof fetch);
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://hooks.slack.test/x");
    expect(JSON.parse(init.body as string)).toEqual({ text: ":rotating_light: Ops Brain: Notion refused access" });
  });

  it("does nothing when no webhook is configured", async () => {
    const fetchFn = vi.fn();
    await postAlert(undefined, "x", fetchFn as unknown as typeof fetch);
    expect(fetchFn).not.toHaveBeenCalled();
  });
});
