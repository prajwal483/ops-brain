import { describe, it, expect } from "vitest";
import { scoreCase, type Expected } from "../src/eval";
import type { ProposedTask } from "../src/schema";

const t = (ref: string, title: string, o: Partial<ProposedTask> = {}): ProposedTask => ({
  ref, title, ownerId: null, due: null, goalId: null, dependsOn: [], sourceQuote: "", confidence: 0.9, reviewReasons: [], ...o,
});

const expected: Expected = {
  tasks: [
    { id: "fssai", match: ["fssai"], owner: null, due: null, goal: "G1", dependsOn: [] },
    { id: "box", match: ["box", "design"], owner: "meera", due: "2026-12-05", goal: "G1", dependsOn: ["TASK-101", "fssai"] },
  ],
  mustNotInclude: [["gujarati", "landing"]],
};

const perfect = () => [
  t("T1", "Check FSSAI rules", { goalId: "G1" }),
  t("T2", "Finalise box design", { ownerId: "meera", due: "2026-12-05", goalId: "G1", dependsOn: ["TASK-101", "T1"] }),
];

describe("scoreCase", () => {
  it("scores a perfect match", () => {
    const s = scoreCase(perfect(), expected);
    expect(s.recall).toBe(1);
    expect(s.total).toEqual({ correct: 8, scored: 8 });
    expect(s.misses).toEqual([]);
    expect(s.extras).toEqual([]);
  });

  it("reports a wrong owner", () => {
    const p = perfect();
    p[1].ownerId = "karan";
    const s = scoreCase(p, expected);
    expect(s.fields.owner).toEqual({ correct: 1, scored: 2 });
    expect(s.misses).toContain("box: owner expected meera got karan");
  });

  it("counts a missed task's scored fields as wrong", () => {
    const s = scoreCase([perfect()[1]], expected);
    expect(s.matchedCount).toBe(1);
    expect(s.recall).toBe(0.5);
    expect(s.fields.owner).toEqual({ correct: 1, scored: 2 });
    // fssai's 4 fields are wrong; box's deps point at the missing fssai, so they are wrong too.
    expect(s.total).toEqual({ correct: 3, scored: 8 });
    expect(s.misses[0]).toMatch(/^fssai: not found .*its 4 scored field\(s\) count as wrong/);
  });

  it("picks the matching title with the most correct fields, not the first one", () => {
    const e: Expected = { tasks: [{ id: "pages", match: ["product", "page"], owner: "karan", due: "2026-12-20", goal: "G1", dependsOn: [] }] };
    const p = [
      t("T1", "Coordinate with freelancer on product pages", { ownerId: "karan" }),
      t("T2", "Get product pages live", { ownerId: "karan", due: "2026-12-20", goalId: "G1" }),
    ];
    const s = scoreCase(p, e);
    expect(s.total).toEqual({ correct: 4, scored: 4 });
    expect(s.extras).toEqual(["Coordinate with freelancer on product pages"]);
    // On a tie the earlier title wins.
    const tie = scoreCase([t("T1", "Product page A", { ownerId: "karan" }), t("T2", "Product page B", { ownerId: "karan" })], e);
    expect(tie.extras).toEqual(["Product page B"]);
  });

  it("keeps a title out of a match when it has a 'not' keyword", () => {
    const e: Expected = {
      tasks: [{ id: "box", match: ["box", "design"], not: ["fssai"], owner: "any", due: "any", goal: "any", dependsOn: "any" }],
    };
    expect(scoreCase([t("T1", "Check FSSAI rules before box design")], e).matchedCount).toBe(0);
  });

  it("accepts any of several values, including null, and any of several dependency sets", () => {
    const e: Expected = {
      tasks: [
        { id: "box", match: ["box"], owner: "any", due: "any", goal: "any", dependsOn: [] },
        { id: "photo", match: ["photo"], owner: ["karan", null], due: "any", goal: ["G1", "G2", null], dependsOn: [["box"], [], ["TASK-101"]] },
      ],
    };
    const correct = (o: Partial<ProposedTask>) => scoreCase([t("T1", "Box"), t("T2", "Photo shoot", o)], e).total.correct;
    expect(correct({ ownerId: null, goalId: null, dependsOn: ["T1"] })).toBe(4);
    expect(correct({ ownerId: "karan", goalId: "G2", dependsOn: ["TASK-101"] })).toBe(4);
    expect(correct({ ownerId: "riya", goalId: "G3", dependsOn: ["T1", "TASK-101"] })).toBe(1);
    const s = scoreCase([t("T1", "Box"), t("T2", "Photo shoot", { ownerId: "riya" })], e);
    expect(s.misses).toContain("photo: owner expected one of karan | null got riya");
  });

  it("scores expectFlag as a field", () => {
    const e: Expected = {
      tasks: [{ id: "quote", match: ["quote"], owner: null, due: "any", goal: "any", dependsOn: "any", expectFlag: "matches more than one" }],
    };
    const flagged = t("T1", "Send quote", { reviewReasons: ['"Priya" matches more than one team member'] });
    expect(scoreCase([flagged], e).fields.flag).toEqual({ correct: 1, scored: 1 });
    const s = scoreCase([t("T1", "Send quote", { reviewReasons: ["AI found no owner. Check the note"] })], e);
    expect(s.fields.flag).toEqual({ correct: 0, scored: 1 });
    expect(s.misses[0]).toMatch(/^quote: flag expected a flag containing "matches more than one"/);
  });

  it("counts an unmatched predicted task as an extra", () => {
    const s = scoreCase([...perfect(), t("T3", "Order stickers")], expected);
    expect(s.extras).toEqual(["Order stickers"]);
  });

  it("flags a parked leak", () => {
    const s = scoreCase([...perfect(), t("T3", "Build Gujarati landing page")], expected);
    expect(s.parkedLeaks).toEqual(["Build Gujarati landing page"]);
  });

  it("maps dependencies through refs, with a different ref numbering", () => {
    const p = [
      t("T7", "Finalise box design", { ownerId: "meera", due: "2026-12-05", goalId: "G1", dependsOn: ["TASK-101", "T9"] }),
      t("T9", "FSSAI check", { goalId: "G1" }),
    ];
    expect(scoreCase(p, expected).fields.dependsOn).toEqual({ correct: 2, scored: 2 });
    p[0].dependsOn = ["T9"];
    const s = scoreCase(p, expected);
    expect(s.fields.dependsOn.correct).toBe(1);
    expect(s.misses.some((m) => m.startsWith("box: dependsOn expected [TASK-101, fssai]"))).toBe(true);
  });

  it("skips fields marked any", () => {
    const e: Expected = { tasks: [{ id: "x", match: ["teaser"], owner: "any", due: "any", goal: "any", dependsOn: "any" }] };
    const s = scoreCase([t("T1", "Teaser calendar", { ownerId: "zzz", goalId: "G9" })], e);
    expect(s.total).toEqual({ correct: 0, scored: 0 });
    expect(s.misses).toEqual([]);
  });
});
