import { describe, it, expect } from "vitest";
import { isValidIsoDate, matchOwner, resolveTasks as resolve } from "../src/resolve";
import type { ExtractedTask, MeetingContext } from "../src/schema";

const ctx: MeetingContext = {
  meetingDate: "2026-11-17",
  meetingTitle: "Launch sync",
  team: [
    { id: "riya", name: "Riya Shah", aliases: ["Riya", "RS"] },
    { id: "karan", name: "Karan Mehta", aliases: ["Karan", "KM"] },
    { id: "aditya", name: "Aditya Rao", aliases: ["Adi"] },
  ],
  goals: [{ id: "G1", title: "Launch the D2C website by 15 Jan 2027" }],
  existingTasks: [{ id: "TASK-101", title: "Finalise packaging vendor", ownerId: "karan", due: "2026-11-28" }],
};

const NOTE = "Aditya will book photographer. Karan to coordinate.\nAditya will book photographer, shoot by 12 Dec.";
const resolveTasks = (e: Parameters<typeof resolve>[0], c: MeetingContext, note = NOTE, o?: Parameters<typeof resolve>[3]) => resolve(e, c, note, o);

function task(overrides: Partial<ExtractedTask> = {}): ExtractedTask {
  return {
    ref: "T1",
    title: "Book photographer",
    owner_name: "Adi",
    due_date: "2026-12-12",
    goal_id: "G1",
    depends_on: [],
    source_quote: "Aditya will book photographer",
    confidence: 0.9,
    ...overrides,
  };
}

describe("matchOwner", () => {
  it("matches aliases case-insensitively", () => {
    expect(matchOwner("adi", ctx.team)).toEqual({ member: ctx.team[2], byFirstNameOnly: false });
  });
  it("matches a unique first name and marks it as first-name-only", () => {
    expect(matchOwner("Karan M.", ctx.team)).toEqual({ member: ctx.team[1], byFirstNameOnly: true });
  });
  it("returns null for someone not on the team", () => {
    expect(matchOwner("Jignesh", ctx.team)).toBeNull();
  });
  it("reports ambiguity when two members share a first name", () => {
    const team = [...ctx.team, { id: "karan2", name: "Karan Singh", aliases: [] }];
    expect(matchOwner("Karan P.", team)).toEqual({ ambiguous: true });
  });
});

describe("isValidIsoDate", () => {
  it("accepts real dates and rejects impossible ones", () => {
    expect(isValidIsoDate("2026-12-05")).toBe(true);
    expect(isValidIsoDate("2026-02-30")).toBe(false);
    expect(isValidIsoDate("Friday")).toBe(false);
  });
});

describe("resolveTasks", () => {
  it("resolves a clean task with no review reasons", () => {
    const [t] = resolveTasks({ tasks: [task()] }, ctx);
    expect(t).toMatchObject({ ownerId: "aditya", due: "2026-12-12", goalId: "G1", reviewReasons: [] });
  });

  it("flags missing owner, date and goal instead of guessing", () => {
    const [t] = resolveTasks({ tasks: [task({ owner_name: null, due_date: null, goal_id: null })] }, ctx);
    expect(t.ownerId).toBeNull();
    expect(t.reviewReasons).toEqual(["AI found no owner. Check the note", "AI found no due date. Check the note", "Not linked to a company goal"]);
  });

  it("flags unknown people, impossible dates, past dates and unknown goals", () => {
    const tasks = resolveTasks(
      {
        tasks: [
          task({ ref: "T1", owner_name: "Jignesh" }),
          task({ ref: "T2", due_date: "2026-02-30" }),
          task({ ref: "T3", due_date: "2026-11-01" }),
          task({ ref: "T4", goal_id: "G9" }),
        ],
      },
      ctx,
    );
    expect(tasks[0].reviewReasons).toContain('"Jignesh" is not in the team list');
    expect(tasks[1].reviewReasons).toContain('"2026-02-30" is not a real date');
    expect(tasks[2].reviewReasons).toContain("Due date 2026-11-01 is before the meeting");
    expect(tasks[2].due).toBeNull();
    expect(tasks[3].reviewReasons).toContain('Goal "G9" does not exist');
  });

  it("keeps dependencies on new and existing tasks and drops unknown ones", () => {
    const tasks = resolveTasks(
      { tasks: [task({ ref: "T1", depends_on: ["TASK-101", "T2", "TASK-999", "T1"] }), task({ ref: "T2", due_date: "2026-12-01" })] },
      ctx,
    );
    expect(tasks[0].dependsOn).toEqual(["TASK-101", "T2"]);
    expect(tasks[0].reviewReasons).toContain('Dropped unknown dependency "TASK-999"');
    expect(tasks[0].reviewReasons).toContain("Task depends on itself");
  });

  it("assigns an owner matched by first name only but flags it", () => {
    const [t] = resolveTasks({ tasks: [task({ owner_name: "Karan M." })] }, ctx);
    expect(t.ownerId).toBe("karan");
    expect(t.reviewReasons).toEqual(['Owner "Karan M." matched to Karan Mehta by first name only']);
  });

  it("flags a task due before something it depends on", () => {
    const [t] = resolveTasks({ tasks: [task({ due_date: "2026-11-25", depends_on: ["TASK-101"] })] }, ctx);
    expect(t.reviewReasons).toContain("Due 2026-11-25, but it depends on TASK-101 which is due later (2026-11-28)");
  });

  it("flags low confidence", () => {
    const [t] = resolveTasks({ tasks: [task({ confidence: 0.4 })] }, ctx);
    expect(t.reviewReasons).toContain("AI was unsure (confidence 0.40)");
  });

  it("says ambiguous first names match more than one team member", () => {
    const amb = { ...ctx, team: [...ctx.team, { id: "karan2", name: "Karan Singh", aliases: [] }] };
    const [t] = resolveTasks({ tasks: [task({ owner_name: "Karan P." })] }, amb);
    expect(t.ownerId).toBeNull();
    expect(t.reviewReasons).toContain('"Karan P." matches more than one team member');
  });

  it("accepts a quote whose whitespace, case or line endings differ from the note", () => {
    const note = "Intro\r\nAditya will   book\r\nphotographer today";
    const [t] = resolveTasks({ tasks: [task({ source_quote: "ADITYA  will\nbook photographer" })] }, ctx, note);
    expect(t.reviewReasons).toEqual([]);
  });

  it("accepts a quote that differs from the note only in markdown emphasis or Unicode composition", () => {
    const note = "Intro. **Aditya** will _book_ the photographer for the café shoot".normalize("NFD");
    const quote = "Aditya will book the photographer for the café shoot".normalize("NFC");
    const [t] = resolveTasks({ tasks: [task({ source_quote: quote })] }, ctx, note);
    expect(t.reviewReasons).toEqual([]);
  });

  it("flags a quote that is not in the note", () => {
    const [t] = resolveTasks({ tasks: [task({ source_quote: "Something never said" })] }, ctx);
    expect(t.reviewReasons).toContain("Quote not found in the note. The AI may have invented this task");
  });

  it("flags every task that shares a ref", () => {
    const tasks = resolveTasks({ tasks: [task({ ref: "T1" }), task({ ref: "T1" }), task({ ref: "T2" })] }, ctx);
    expect(tasks[0].reviewReasons).toContain("Duplicate task id T1 from the AI");
    expect(tasks[1].reviewReasons).toContain("Duplicate task id T1 from the AI");
    expect(tasks[2].reviewReasons).toEqual([]);
  });

  it("uses the lowConfidence option", () => {
    const [t] = resolveTasks({ tasks: [task({ confidence: 0.9 })] }, ctx, NOTE, { lowConfidence: 0.95 });
    expect(t.reviewReasons).toContain("AI was unsure (confidence 0.90)");
  });

  it("flags every task in a circular dependency", () => {
    const tasks = resolveTasks(
      { tasks: [task({ ref: "T1", depends_on: ["T2"] }), task({ ref: "T2", depends_on: ["T1"] })] },
      ctx,
    );
    expect(tasks[0].reviewReasons).toContain("Circular dependency: T1 → T2 → T1");
    expect(tasks[1].reviewReasons).toContain("Circular dependency: T1 → T2 → T1");
  });
});
