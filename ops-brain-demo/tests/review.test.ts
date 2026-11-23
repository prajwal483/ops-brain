import { describe, it, expect } from "vitest";
import { formatReview } from "../src/review";
import type { MeetingContext, ProposedTask } from "../src/schema";

const ctx: MeetingContext = {
  meetingDate: "2026-11-17",
  meetingTitle: "Launch sync",
  team: [{ id: "meera", name: "Meera Iyer", aliases: [] }],
  goals: [{ id: "G1", title: "Launch the D2C website" }],
  existingTasks: [],
};

const clean: ProposedTask = {
  ref: "T1", title: "Finalise box design", ownerId: "meera", due: "2026-12-05", goalId: "G1",
  dependsOn: ["TASK-101"], sourceQuote: "q", confidence: 0.9, reviewReasons: [],
};
const flagged: ProposedTask = { ...clean, ref: "T2", title: "Check labelling compliance", ownerId: null, reviewReasons: ["AI found no owner. Check the note"] };

describe("formatReview", () => {
  it("says so when there are no tasks", () => {
    expect(formatReview([], ctx)).toContain("No tasks found. Check the note, or that it contains decisions");
  });

  it("summarises counts and shows each task with its flags", () => {
    const text = formatReview([clean, flagged], ctx);
    expect(text).toContain('Proposed tasks from "Launch sync" (2026-11-17): 2 tasks, 1 needs a look');
    expect(text).toContain("✓ T1  Finalise box design");
    expect(text).toContain("owner: Meera Iyer | due: 2026-12-05 | goal: Launch the D2C website | after: TASK-101");
    expect(text).toContain("⚠ T2  Check labelling compliance");
    expect(text).toContain("owner: — |");
    expect(text).toContain("    ⚠ AI found no owner. Check the note");
  });

  it("uses singular and plural correctly", () => {
    expect(formatReview([clean], ctx)).toContain("1 task, 0 need a look");
  });
});
