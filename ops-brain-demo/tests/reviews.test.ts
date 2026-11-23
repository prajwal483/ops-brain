import { describe, it, expect } from "vitest";
import { mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { appendReviewEvent, findRun, parseDecisions, summarizeReviews, type ReviewEvent } from "../src/reviews";
import { appendRunLog, type RunLog } from "../src/runlog";

const refs = ["T1", "T2", "T3", "T4", "T5"];
const tmp = () => mkdtempSync(join(tmpdir(), "ob-reviews-"));

describe("parseDecisions", () => {
  it("approves a list of refs", () => {
    const d = parseDecisions({ approve: "T1,T2", reject: "T3,T4,T5" }, refs);
    expect(d.slice(0, 2)).toEqual([
      { ref: "T1", outcome: "approved" },
      { ref: "T2", outcome: "approved" },
    ]);
  });

  it("approve all covers everything not rejected or edited", () => {
    const d = parseDecisions({ approve: "all", reject: "T2", edit: ["T3:due=2026-12-12"] }, refs);
    expect(d.map((x) => `${x.ref}:${x.outcome}`)).toEqual(["T1:approved", "T2:rejected", "T3:edited", "T4:approved", "T5:approved"]);
  });

  it("records edited fields", () => {
    const d = parseDecisions({ approve: "all", edit: ["T3:due=2026-12-12,owner=aditya"] }, refs);
    expect(d.find((x) => x.ref === "T3")).toEqual({ ref: "T3", outcome: "edited", editedFields: { due: "2026-12-12", owner: "aditya" } });
  });

  it("rejects an unknown ref", () => {
    expect(() => parseDecisions({ approve: "all", reject: "T9" }, refs, "run_x")).toThrow("Task T9 is not in run run_x");
  });

  it("rejects two decisions for one ref", () => {
    expect(() => parseDecisions({ approve: "T1,T2,T3,T4,T5", reject: "T2" }, refs)).toThrow(/T2.*more than one decision/);
  });

  it("rejects a field that is not allowed", () => {
    expect(() => parseDecisions({ approve: "all", edit: ["T3:color=red"] }, refs)).toThrow(/"color".*title, owner, due, goal, dependsOn/);
  });

  it("lists undecided refs", () => {
    expect(() => parseDecisions({ approve: "T1,T3,T4" }, refs)).toThrow(
      "No decision for T2, T5. Use --approve, --edit or --reject (or --approve all)",
    );
  });
});

const ev = (runId: string, decisions: ReviewEvent["decisions"], reviewedAt = "2026-11-19T10:00:00.000Z"): ReviewEvent => ({
  runId,
  reviewedAt,
  reviewer: "sam",
  decisions,
});

describe("appendReviewEvent + summarizeReviews", () => {
  it("returns zeros when there are no reviews", () => {
    expect(summarizeReviews(join(tmp(), "none.jsonl"))).toEqual({
      runs: 0, tasks: 0, approved: 0, edited: 0, rejected: 0, approvedUneditedPct: 0, editedFieldCounts: {},
    });
  });

  it("uses the latest review per run and counts edited fields", () => {
    const path = join(tmp(), "nested", "reviews.jsonl");
    appendReviewEvent(path, ev("run_a", [
      { ref: "T1", outcome: "approved" },
      { ref: "T2", outcome: "rejected" },
      { ref: "T3", outcome: "edited", editedFields: { due: "2026-12-12", owner: "aditya" } },
    ]));
    appendReviewEvent(path, ev("run_b", [
      { ref: "T1", outcome: "approved" },
      { ref: "T2", outcome: "edited", editedFields: { due: "2026-12-01" } },
    ]));
    expect(summarizeReviews(path)).toEqual({
      runs: 2, tasks: 5, approved: 2, edited: 2, rejected: 1, approvedUneditedPct: 40,
      editedFieldCounts: { due: 2, owner: 1 },
    });

    // re-review run_a: everything approved, replaces the earlier review
    appendReviewEvent(path, ev("run_a", [
      { ref: "T1", outcome: "approved" },
      { ref: "T2", outcome: "approved" },
      { ref: "T3", outcome: "approved" },
    ], "2026-11-20T10:00:00.000Z"));
    expect(summarizeReviews(path)).toEqual({
      runs: 2, tasks: 5, approved: 4, edited: 1, rejected: 0, approvedUneditedPct: 80,
      editedFieldCounts: { due: 1 },
    });
  });

  it("rounds to one decimal place", () => {
    const path = join(tmp(), "reviews.jsonl");
    appendReviewEvent(path, ev("run_a", [
      { ref: "T1", outcome: "approved" },
      { ref: "T2", outcome: "rejected" },
      { ref: "T3", outcome: "rejected" },
    ]));
    expect(summarizeReviews(path).approvedUneditedPct).toBe(33.3);
  });
});

describe("findRun", () => {
  const base: RunLog = {
    runId: "run_ok", job: "extract_tasks", startedAt: "2026-11-19T10:00:00.000Z", promptId: "p", promptVersion: "1",
    model: "m", attempts: 1, inputTokens: 1, outputTokens: 1, costUsd: 0, inputSha256: "x", inputPreview: "n",
    output: [], error: null, reviewStatus: "pending",
  };

  it("finds a successful run, and explains missing and failed runs", () => {
    const path = join(tmp(), "runs.jsonl");
    appendRunLog(path, base);
    appendRunLog(path, { ...base, runId: "run_bad", output: null, error: "boom" });
    expect(findRun(path, "run_ok").runId).toBe("run_ok");
    expect(() => findRun(path, "run_nope")).toThrow("Run run_nope was not found in the run log");
    expect(() => findRun(path, "run_bad")).toThrow(/Run run_bad failed.*nothing to review/);
  });

  it("explains when there is no run log at all", () => {
    expect(() => findRun(join(tmp(), "missing.jsonl"), "run_x")).toThrow("Run run_x was not found in the run log");
  });
});
