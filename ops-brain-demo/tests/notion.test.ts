import { describe, it, expect } from "vitest";
import { toNotionProperties, writeProposedTasks, type NotionPagesApi } from "../src/notion";
import type { MeetingContext, ProposedTask } from "../src/schema";

const ctx: MeetingContext = {
  meetingDate: "2026-11-17",
  meetingTitle: "Launch sync",
  team: [{ id: "meera", name: "Meera Iyer", aliases: [], notionUserId: "user-meera" }],
  goals: [{ id: "G1", title: "Launch", notionPageId: "page-goal-1" }],
  existingTasks: [{ id: "TASK-101", title: "Vendor", ownerId: "karan", due: "2026-11-28", notionPageId: "page-task-101" }],
};

const t1: ProposedTask = {
  ref: "T1", title: "Finalise box design", ownerId: "meera", due: "2026-12-05", goalId: "G1",
  dependsOn: ["TASK-101", "T2"], sourceQuote: "box design final karna hai", confidence: 0.9, reviewReasons: ["AI was unsure (confidence 0.60)"],
};
const t2: ProposedTask = { ...t1, ref: "T2", title: "Check compliance", ownerId: null, due: null, goalId: null, dependsOn: [], reviewReasons: [] };

function fakeNotion() {
  const created: { parent: { database_id: string }; properties: Record<string, unknown> }[] = [];
  const updated: { page_id: string; properties: Record<string, unknown> }[] = [];
  const api: NotionPagesApi = {
    pages: {
      create: async (args) => {
        created.push(args);
        return { id: `page-${created.length}` };
      },
      update: async (args) => {
        updated.push(args);
        return {};
      },
    },
  };
  return { api, created, updated };
}

describe("toNotionProperties", () => {
  it("maps a task to Notion properties with Status Proposed", () => {
    const props = toNotionProperties(t1, ctx, "run_1");
    expect(props).toMatchObject({
      Name: { title: [{ type: "text", text: { content: "Finalise box design" } }] },
      Status: { select: { name: "Proposed" } },
      Owner: { people: [{ id: "user-meera" }] },
      Due: { date: { start: "2026-12-05" } },
      Goal: { relation: [{ id: "page-goal-1" }] },
      "Run ID": { rich_text: [{ type: "text", text: { content: "run_1" } }] },
    });
    const notes = (props["AI notes"] as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content;
    expect(notes).toBe('⚠ AI was unsure (confidence 0.60)\nSource: "box design final karna hai"');
  });

  it("flags an existing-task dependency that has no Notion page id", () => {
    const ctxNoPage: MeetingContext = {
      ...ctx,
      existingTasks: [{ id: "TASK-101", title: "Vendor", ownerId: "karan", due: "2026-11-28" }],
    };
    const task: ProposedTask = { ...t1, reviewReasons: [], dependsOn: ["TASK-101", "T2"] };
    const notes = (toNotionProperties(task, ctxNoPage, "run_1")["AI notes"] as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content;
    expect(notes).toBe('⚠ Couldn\'t link TASK-101 in Notion (no page id); link it by hand\nSource: "box design final karna hai"');
  });

  it("says when an owner or goal cannot be set in Notion", () => {
    const bare: MeetingContext = {
      ...ctx,
      team: [{ id: "meera", name: "Meera Iyer", aliases: [] }],
      goals: [{ id: "G1", title: "Launch" }],
    };
    const task: ProposedTask = { ...t1, reviewReasons: [], dependsOn: [] };
    const notes = (toNotionProperties(task, bare, "run_1")["AI notes"] as { rich_text: { text: { content: string } }[] }).rich_text[0].text.content;
    expect(notes).toBe(
      "⚠ Couldn't set owner Meera Iyer in Notion (no user id); set it by hand\n⚠ Couldn't link goal G1 in Notion (no page id); link it by hand\nSource: \"box design final karna hai\"",
    );
  });

  it("leaves owner, date and goal empty when unresolved", () => {
    expect(toNotionProperties(t2, ctx, "run_1")).toMatchObject({ Owner: { people: [] }, Due: { date: null }, Goal: { relation: [] } });
  });
});

describe("writeProposedTasks", () => {
  it("creates every page first, then links Blocked by to new and existing pages", async () => {
    const { api, created, updated } = fakeNotion();
    const ids = await writeProposedTasks(api, "db-tasks", [t1, t2], ctx, "run_1");

    expect(created).toHaveLength(2);
    expect(created[0].parent).toEqual({ database_id: "db-tasks" });
    expect([...ids.entries()]).toEqual([["T1", "page-1"], ["T2", "page-2"]]);
    expect(updated).toEqual([
      { page_id: "page-1", properties: { "Blocked by": { relation: [{ id: "page-task-101" }, { id: "page-2" }] } } },
    ]);
  });
});
