import { describe, it, expect } from "vitest";
import { ExtractionError, buildSystemPrompt, extractTasks, parseExtraction } from "../src/extract";
import type { MeetingContext } from "../src/schema";
import type { PromptConfig } from "../src/config";
import { LlmError } from "../src/llm";
import { FakeLlmClient } from "./helpers/fake-llm";

const ctx: MeetingContext = {
  meetingDate: "2026-11-17",
  meetingTitle: "Launch sync",
  team: [{ id: "meera", name: "Meera Iyer", aliases: ["Meera"] }],
  goals: [{ id: "G1", title: "Launch the D2C website by 15 Jan 2027" }],
  existingTasks: [{ id: "TASK-101", title: "Finalise packaging vendor", ownerId: "karan", due: "2026-11-28" }],
};

const prompt: PromptConfig = {
  id: "extract-tasks",
  version: "1",
  text: "Date {{meeting_date}} / {{meeting_title}}\nTeam:\n{{team}}\nGoals:\n{{goals}}\nExisting:\n{{existing_tasks}}",
};

const route = { model: "test/model", inputUsdPerMTok: 1, outputUsdPerMTok: 5 };

const good = JSON.stringify({
  tasks: [
    { ref: "T1", title: "Finalise box design", owner_name: "Meera", due_date: "2026-12-05", goal_id: "G1", depends_on: ["TASK-101"], source_quote: "box design final karna hai", confidence: 0.9 },
  ],
});

describe("buildSystemPrompt", () => {
  it("lists the team, goals and existing tasks for the model", () => {
    const text = buildSystemPrompt(prompt, ctx);
    expect(text).toContain("Date 2026-11-17 (Tuesday) / Launch sync");
    expect(text).toContain("- Meera Iyer (also: Meera)");
    expect(text).toContain("- G1: Launch the D2C website by 15 Jan 2027");
    expect(text).toContain("- TASK-101: Finalise packaging vendor (owner karan, due 2026-11-28)");
  });
});

describe("parseExtraction", () => {
  it("accepts JSON wrapped in a markdown fence", () => {
    const res = parseExtraction("```json\n" + good + "\n```");
    expect(res.ok).toBe(true);
  });

  it("accepts prose before a JSON fence", () => {
    const res = parseExtraction("Here is the JSON:\n```json\n" + good + "\n```");
    expect(res.ok).toBe(true);
  });

  it("parses JSON followed by trailing prose", () => {
    expect(parseExtraction(good + "\nHope this helps!").ok).toBe(true);
  });

  it("explains which field is wrong", () => {
    const res = parseExtraction(JSON.stringify({ tasks: [{ ref: "T1" }] }));
    expect(res.ok).toBe(false);
    if (!res.ok) expect(res.error).toContain("tasks.0.title");
  });
});

describe("extractTasks", () => {
  it("returns the extraction on the first good answer", async () => {
    const llm = new FakeLlmClient([good]);
    const res = await extractTasks("note text", ctx, { llm, route, prompt });
    expect(res.attempts).toBe(1);
    expect(res.extraction.tasks[0].title).toBe("Finalise box design");
    expect(llm.calls[0].user).toBe("note text");
    expect(llm.calls[0].model).toBe("test/model");
  });

  it("retries once with the error and sums token usage", async () => {
    const llm = new FakeLlmClient(["not json", good]);
    const res = await extractTasks("note text", ctx, { llm, route, prompt });
    expect(res.attempts).toBe(2);
    expect(res.inputTokens).toBe(2000);
    expect(llm.calls[1].user).toContain("Your previous answer was:\nnot json");
    expect(llm.calls[1].user).toContain("It was rejected: Not valid JSON");
  });

  it("keeps the provider error and its status, plus earlier token usage, when the retry call itself fails", async () => {
    const fake = new FakeLlmClient(["not json"]);
    const llm = {
      complete: async (req: Parameters<FakeLlmClient["complete"]>[0]) => {
        if (fake.calls.length === 1) throw new LlmError("Model provider returned 503: busy", 503);
        return fake.complete(req);
      },
    };
    const err = await extractTasks("note text", ctx, { llm, route, prompt }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.status).toBe(503);
    expect(err.message).toBe("Model provider returned 503: busy");
    expect(err.usage).toMatchObject({ attempts: 1, inputTokens: 1000, outputTokens: 200 });
  });

  it("gives up with an ExtractionError after two bad answers", async () => {
    const llm = new FakeLlmClient(["nope", "still nope"]);
    await expect(extractTasks("note text", ctx, { llm, route, prompt })).rejects.toBeInstanceOf(ExtractionError);
  });
});
