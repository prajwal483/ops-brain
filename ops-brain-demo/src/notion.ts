import type { MeetingContext, ProposedTask } from "./schema";

// The subset of @notionhq/client we use, so tests can pass a fake.
export interface NotionPagesApi {
  pages: {
    create(args: { parent: { database_id: string }; properties: Record<string, unknown> }): Promise<{ id: string }>;
    update(args: { page_id: string; properties: Record<string, unknown> }): Promise<unknown>;
  };
}

const text = (content: string) => [{ type: "text", text: { content: content.slice(0, 2000) } }];

export function toNotionProperties(task: ProposedTask, ctx: MeetingContext, runId: string): Record<string, unknown> {
  const owner = ctx.team.find((m) => m.id === task.ownerId);
  const goal = ctx.goals.find((g) => g.id === task.goalId);
  // Existing-task deps without a Notion page id can't be linked; say so instead of dropping them silently.
  const unlinkable = task.dependsOn
    .filter((dep) => ctx.existingTasks.some((e) => e.id === dep && !e.notionPageId))
    .map((dep) => `⚠ Couldn't link ${dep} in Notion (no page id); link it by hand`);
  const unsettable = [
    ...(owner && !owner.notionUserId ? [`⚠ Couldn't set owner ${owner.name} in Notion (no user id); set it by hand`] : []),
    ...(task.goalId && goal && !goal.notionPageId ? [`⚠ Couldn't link goal ${goal.id} in Notion (no page id); link it by hand`] : []),
  ];
  const notes = [...task.reviewReasons.map((r) => `⚠ ${r}`), ...unlinkable, ...unsettable, `Source: "${task.sourceQuote}"`].join("\n");
  return {
    Name: { title: text(task.title) },
    Status: { select: { name: "Proposed" } },
    Owner: { people: owner?.notionUserId ? [{ id: owner.notionUserId }] : [] },
    Due: { date: task.due ? { start: task.due } : null },
    Goal: { relation: goal?.notionPageId ? [{ id: goal.notionPageId }] : [] },
    "AI notes": { rich_text: text(notes) },
    "Run ID": { rich_text: text(runId) },
  };
}

// Pages are created first so dependencies between new tasks can point at real page ids.
export async function writeProposedTasks(
  notion: NotionPagesApi,
  databaseId: string,
  tasks: ProposedTask[],
  ctx: MeetingContext,
  runId: string,
): Promise<Map<string, string>> {
  const pageIdByRef = new Map<string, string>();
  for (const t of tasks) {
    const page = await notion.pages.create({ parent: { database_id: databaseId }, properties: toNotionProperties(t, ctx, runId) });
    pageIdByRef.set(t.ref, page.id);
  }

  const existingPageIds = new Map(
    ctx.existingTasks.filter((t) => t.notionPageId).map((t) => [t.id, t.notionPageId as string] as const),
  );
  for (const t of tasks) {
    const ids = t.dependsOn
      .map((dep) => pageIdByRef.get(dep) ?? existingPageIds.get(dep))
      .filter((id): id is string => Boolean(id));
    if (ids.length > 0) {
      await notion.pages.update({ page_id: pageIdByRef.get(t.ref)!, properties: { "Blocked by": { relation: ids.map((id) => ({ id })) } } });
    }
  }
  return pageIdByRef;
}
