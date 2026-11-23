import { describe, it, expect } from "vitest";
import { mkdtempSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendRunLog, findPreviousRun, newRunId, sha256, type RunLog } from "../src/runlog";

const log: RunLog = {
  runId: "run_x",
  job: "extract_tasks",
  startedAt: "2026-11-19T10:00:00.000Z",
  promptId: "extract-tasks",
  promptVersion: "1",
  model: "test/model",
  attempts: 1,
  inputTokens: 10,
  outputTokens: 5,
  costUsd: 0.00001,
  inputSha256: "abc",
  inputPreview: "note",
  output: [],
  error: null,
  reviewStatus: "pending",
};

describe("run log", () => {
  it("makes sortable run ids from the time", () => {
    expect(newRunId(new Date("2026-11-19T10:20:30.123Z"))).toMatch(/^run_20261119T102030_[0-9a-f]{4}$/);
  });

  it("hashes input so runs on the same note can be spotted", () => {
    expect(sha256("hello")).toBe("2cf24dba5fb0a30e26e83b2ac5b9e29e1b161e5c1fa7425e73043362938b9824");
  });

  it("appends one JSON line per run, creating the folder", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ob-runs-")), "nested", "runs.jsonl");
    appendRunLog(path, log);
    appendRunLog(path, { ...log, runId: "run_y" });
    const lines = readFileSync(path, "utf8").trim().split("\n").map((l) => JSON.parse(l));
    expect(lines.map((l) => l.runId)).toEqual(["run_x", "run_y"]);
  });
});

describe("findPreviousRun", () => {
  it("returns null when there is no run log yet", () => {
    expect(findPreviousRun(join(mkdtempSync(join(tmpdir(), "ob-prev-")), "runs.jsonl"), "abc")).toBeNull();
  });

  it("finds the latest successful run on the same note, ignoring failed runs and other notes", () => {
    const path = join(mkdtempSync(join(tmpdir(), "ob-prev-")), "runs.jsonl");
    appendRunLog(path, { ...log, runId: "run_old" });
    appendRunLog(path, { ...log, runId: "run_new" });
    appendRunLog(path, { ...log, runId: "run_failed", output: null, error: "boom" });
    appendRunLog(path, { ...log, runId: "run_other", inputSha256: "def" });
    expect(findPreviousRun(path, "abc")?.runId).toBe("run_new");
    expect(findPreviousRun(path, "zzz")).toBeNull();
  });
});
