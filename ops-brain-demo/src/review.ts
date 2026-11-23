import type { MeetingContext, ProposedTask } from "./schema";

export function formatReview(tasks: ProposedTask[], ctx: MeetingContext): string {
  const nameOf = (id: string | null) => (id ? ctx.team.find((m) => m.id === id)?.name ?? id : "—");
  const goalOf = (id: string | null) => (id ? ctx.goals.find((g) => g.id === id)?.title ?? id : "—");
  const flagged = tasks.filter((t) => t.reviewReasons.length > 0).length;

  const lines = [`Proposed tasks from "${ctx.meetingTitle}" (${ctx.meetingDate}): ${tasks.length} ${tasks.length === 1 ? "task" : "tasks"}, ${flagged} ${flagged === 1 ? "needs" : "need"} a look`, ""];
  if (tasks.length === 0) lines.push("No tasks found. Check the note, or that it contains decisions");
  for (const t of tasks) {
    lines.push(`${t.reviewReasons.length ? "⚠" : "✓"} ${t.ref}  ${t.title}`);
    lines.push(`    owner: ${nameOf(t.ownerId)} | due: ${t.due ?? "—"} | goal: ${goalOf(t.goalId)} | after: ${t.dependsOn.join(", ") || "—"}`);
    for (const reason of t.reviewReasons) lines.push(`    ⚠ ${reason}`);
  }
  return lines.join("\n");
}
