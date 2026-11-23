import { describe, it, expect } from "vitest";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { runPipeline } from "../src/pipeline";
import { loadModelsConfig, loadPrompt, routeFor } from "../src/config";
import type { MeetingContext } from "../src/schema";
import { FakeLlmClient } from "./helpers/fake-llm";
import { LlmError } from "../src/llm";
import { explainError } from "../src/alerts";

const context = JSON.parse(readFileSync("fixtures/context.json", "utf8")) as MeetingContext;
const note = readFileSync("fixtures/meeting-2026-11-17-launch-sync.md", "utf8");

const modelAnswer = JSON.stringify({
  tasks: [
    { ref: "T1", title: "Check FSSAI labelling rules for box print", owner_name: null, due_date: null, goal_id: "G1", depends_on: [], source_quote: "Somebody has to check FSSAI labelling rules", confidence: 0.8 },
    { ref: "T2", title: "Finalise box design", owner_name: "Meera", due_date: "2026-12-05", goal_id: "G1", depends_on: ["TASK-101", "T1"], source_quote: "Meera ko box design final karna hai, target 5 Dec", confidence: 0.9 },
    { ref: "T3", title: "Book photographer and shoot products", owner_name: "Aditya", due_date: "2026-12-12", goal_id: "G1", depends_on: ["T2"], source_quote: "Aditya will book the photographer; shoot by 12 Dec", confidence: 0.85 },
    { ref: "T4", title: "Get product pages live with Shopify freelancer", owner_name: "Karan", due_date: "2026-12-20", goal_id: "G1", depends_on: ["T3"], source_quote: "Karan to coordinate with the Shopify freelancer", confidence: 0.85 },
    { ref: "T5", title: "Draft Instagram teaser content calendar", owner_name: "Adi", due_date: "2026-11-20", goal_id: "G2", depends_on: [], source_quote: "Adi, teaser content calendar draft Friday tak", confidence: 0.8 },
  ],
});

function dirs() {
  const root = mkdtempSync(join(tmpdir(), "ob-pipe-"));
  return { runLogPath: join(root, "runs", "runs.jsonl"), outDir: join(root, "out") };
}

// Pipeline tests use their own model route so the shipped config/models.json can change freely.
function testConfigDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "ob-pipe-config-"));
  mkdirSync(join(dir, "prompts"));
  copyFileSync(join("config", "prompts", "extract-tasks.md"), join(dir, "prompts", "extract-tasks.md"));
  writeFileSync(join(dir, "models.json"), JSON.stringify({ jobs: { extract_tasks: { model: "test/model", inputUsdPerMTok: 1, outputUsdPerMTok: 5 } } }));
  return dir;
}

describe("the shipped config", () => {
  it("routes extract_tasks to a model with prices", () => {
    const route = routeFor(loadModelsConfig("config"), "extract_tasks");
    expect(route.model).toMatch(/^[\w.-]+\/[\w.:-]+$/);
    expect(route.inputUsdPerMTok).toBeGreaterThanOrEqual(0);
    expect(route.outputUsdPerMTok).toBeGreaterThanOrEqual(0);
  });

  it("keeps the paid Haiku route at its OpenRouter price", () => {
    expect(routeFor(loadModelsConfig("config"), "extract_tasks_paid")).toEqual({
      model: "anthropic/claude-haiku-5.5",
      inputUsdPerMTok: 0.1,
      outputUsdPerMTok: 0.5,
    });
  });
});

describe("the shipped extract-tasks prompt", () => {
  it("loads with an id and version", () => {
    expect(loadPrompt("config", "extract-tasks")).toMatchObject({ id: "extract-tasks", version: "2" });
  });
});

describe("runPipeline", () => {
  it("extracts, resolves, saves output and logs the run", async () => {
    const { runLogPath, outDir } = dirs();
    const llm = new FakeLlmClient([modelAnswer]);

    const result = await runPipeline(
      { note, context, configDir: testConfigDir(), runLogPath, outDir },
      { llm, now: () => new Date("2026-11-19T10:00:00Z") },
    );

    expect(result.tasks).toHaveLength(5);
    expect(result.tasks[1]).toMatchObject({ ownerId: "meera", dependsOn: ["TASK-101", "T1"], reviewReasons: [] });
    expect(result.tasks[0].reviewReasons).toEqual(["AI found no owner. Check the note", "AI found no due date. Check the note"]);
    expect(result.review).toContain("5 tasks, 1 needs a look");
    expect(result.costUsd).toBeCloseTo((1000 * 1 + 200 * 5) / 1_000_000, 9);
    expect(existsSync(result.outFile)).toBe(true);
    expect(llm.calls[0].system).toContain("- TASK-101: Finalise packaging vendor");

    const [log] = readFileSync(runLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log).toMatchObject({
      runId: result.runId,
      job: "extract_tasks",
      promptId: "extract-tasks",
      promptVersion: "2",
      model: "test/model",
      attempts: 1,
      reviewStatus: "pending",
      error: null,
    });
    expect(log.output).toHaveLength(5);
  });

  it("passes rules.lowConfidence from the models config to resolution", async () => {
    const { runLogPath, outDir } = dirs();
    const configDir = testConfigDir();
    writeFileSync(join(configDir, "models.json"), JSON.stringify({ rules: { lowConfidence: 0.95 }, jobs: { extract_tasks: { model: "test/model", inputUsdPerMTok: 1, outputUsdPerMTok: 5 } } }));
    const result = await runPipeline({ note, context, configDir, runLogPath, outDir }, { llm: new FakeLlmClient([modelAnswer]) });
    expect(result.tasks[1].reviewReasons).toContain("AI was unsure (confidence 0.90)");
  });

  it("succeeds with zero tasks and says so in the review", async () => {
    const { runLogPath, outDir } = dirs();
    const result = await runPipeline({ note, context, configDir: testConfigDir(), runLogPath, outDir }, { llm: new FakeLlmClient([JSON.stringify({ tasks: [] })]) });
    expect(result.tasks).toEqual([]);
    expect(result.review).toContain("No tasks found. Check the note, or that it contains decisions");
    const [log] = readFileSync(runLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.error).toBeNull();
  });

  it("logs a failed run and rethrows", async () => {
    const { runLogPath, outDir } = dirs();
    const llm = new FakeLlmClient(["garbage", "more garbage"]);

    await expect(runPipeline({ note, context, configDir: testConfigDir(), runLogPath, outDir }, { llm })).rejects.toThrow(/expected format/);

    const [log] = readFileSync(runLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.output).toBeNull();
    expect(log.error).toMatch(/expected format/);
    expect(log.attempts).toBe(2);
    expect(log.inputTokens).toBe(2000);
    expect(log.costUsd).toBeGreaterThan(0);
  });

  it("keeps the provider status and logs earlier spend when the retry call fails", async () => {
    const { runLogPath, outDir } = dirs();
    const fake = new FakeLlmClient(["garbage"]);
    const llm = {
      complete: async (req: Parameters<FakeLlmClient["complete"]>[0]) => {
        if (fake.calls.length === 1) throw new LlmError("Model provider returned 429: slow down", 429);
        return fake.complete(req);
      },
    };

    const err = await runPipeline({ note, context, configDir: testConfigDir(), runLogPath, outDir }, { llm }).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err.status).toBe(429);
    expect(explainError(err)).toContain("runbook: 'Out of credit'");

    const [log] = readFileSync(runLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log).toMatchObject({ attempts: 1, inputTokens: 1000, outputTokens: 200, output: null });
    expect(log.costUsd).toBeGreaterThan(0);
  });

  it("keeps spend and output in the log when Notion fails after the AI call", async () => {
    const { runLogPath, outDir } = dirs();
    const llm = new FakeLlmClient([modelAnswer]);
    const api = {
      pages: {
        create: async () => {
          throw new Error("notion down");
        },
        update: async () => ({}),
      },
    };

    await expect(
      runPipeline({ note, context, configDir: testConfigDir(), runLogPath, outDir }, { llm, notion: { api, databaseId: "db" } }),
    ).rejects.toThrow(/notion down/);

    const [log] = readFileSync(runLogPath, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(log.attempts).toBe(1);
    expect(log.inputTokens).toBe(1000);
    expect(log.costUsd).toBeCloseTo(0.002, 9);
    expect(log.output).toHaveLength(5);
    expect(log.error).toMatch(/notion down/);
  });
});
