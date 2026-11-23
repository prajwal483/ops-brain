import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import { createHash, randomBytes } from "node:crypto";
import type { ProposedTask } from "./schema";

export type ReviewStatus = "pending" | "approved" | "edited" | "rejected";

// One line per run. In v1 this becomes a row in the Notion "AI Runs" database.
// reviewStatus is written as "pending" and never updated in this file: review outcomes
// are recorded in runs/reviews.jsonl, keyed by runId, via `npm run review`.
export interface RunLog {
  runId: string;
  job: string;
  startedAt: string;
  promptId: string;
  promptVersion: string;
  model: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
  costUsd: number;
  inputSha256: string;
  inputPreview: string;
  output: ProposedTask[] | null;
  error: string | null;
  reviewStatus: ReviewStatus;
}

export function newRunId(now = new Date()): string {
  return `run_${now.toISOString().replace(/[-:]/g, "").slice(0, 15)}_${randomBytes(2).toString("hex")}`;
}

export function sha256(text: string): string {
  return createHash("sha256").update(text).digest("hex");
}

export function appendRunLog(path: string, log: RunLog): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(log) + "\n", "utf8");
}

// The latest successful run on exactly this note text, so a re-run can be stopped
// before it creates duplicate Proposed tasks.
export function findPreviousRun(path: string, inputSha256: string): RunLog | null {
  if (!existsSync(path)) return null;
  const runs = readFileSync(path, "utf8")
    .split("\n")
    .filter((line) => line.trim())
    .map((line) => JSON.parse(line) as RunLog);
  return runs.filter((r) => r.inputSha256 === inputSha256 && r.output !== null).pop() ?? null;
}
