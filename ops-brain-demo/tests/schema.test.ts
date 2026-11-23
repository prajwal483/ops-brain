import { describe, it, expect } from "vitest";
import { ExtractionSchema } from "../src/schema";

const base = {
  ref: "T1",
  title: "Finalise box design",
  owner_name: "Meera",
  due_date: "2026-12-05",
  goal_id: "G1",
  source_quote: "Meera ko box design final karna hai",
  confidence: 0.9,
};

describe("ExtractionSchema", () => {
  it("defaults depends_on to an empty list", () => {
    const parsed = ExtractionSchema.parse({ tasks: [base] });
    expect(parsed.tasks[0].depends_on).toEqual([]);
  });

  it("accepts nulls for owner, date and goal", () => {
    const parsed = ExtractionSchema.parse({ tasks: [{ ...base, owner_name: null, due_date: null, goal_id: null }] });
    expect(parsed.tasks[0].owner_name).toBeNull();
  });

  it("rejects an empty source quote", () => {
    expect(ExtractionSchema.safeParse({ tasks: [{ ...base, source_quote: "" }] }).success).toBe(false);
  });

  it("rejects confidence above 1", () => {
    expect(ExtractionSchema.safeParse({ tasks: [{ ...base, confidence: 2 }] }).success).toBe(false);
  });
});
