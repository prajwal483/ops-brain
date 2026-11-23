import type { Extraction, MeetingContext, ProposedTask, TeamMember } from "./schema";
import { findCycle } from "./graph";

const DEFAULT_LOW_CONFIDENCE = 0.7;

// Markdown emphasis (*, _) and Unicode composition differences shouldn't make a real quote look invented.
const normalise = (s: string) =>
  s.normalize("NFC").replace(/\r\n/g, "\n").replace(/[*_]/g, "").replace(/\s+/g, " ").trim().toLowerCase();

export function matchOwner(name: string, team: TeamMember[]): { member: TeamMember; byFirstNameOnly: boolean } | { ambiguous: true } | null {
  const n = name.trim().toLowerCase();
  const exact = team.find((m) => [m.name, ...m.aliases].some((a) => a.toLowerCase() === n));
  if (exact) return { member: exact, byFirstNameOnly: false };
  const first = n.split(/\s+/)[0];
  const byFirst = team.filter((m) => m.name.toLowerCase().split(/\s+/)[0] === first);
  if (byFirst.length > 1) return { ambiguous: true };
  return byFirst.length === 1 ? { member: byFirst[0], byFirstNameOnly: true } : null;
}

export function isValidIsoDate(s: string): boolean {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(s)) return false;
  const d = new Date(`${s}T00:00:00Z`);
  return !Number.isNaN(d.getTime()) && d.toISOString().slice(0, 10) === s;
}

export function resolveTasks(
  extraction: Extraction,
  ctx: MeetingContext,
  note: string,
  options: { lowConfidence?: number } = {},
): ProposedTask[] {
  const lowConfidence = options.lowConfidence ?? DEFAULT_LOW_CONFIDENCE;
  const normalisedNote = normalise(note);
  const refCounts = new Map<string, number>();
  for (const t of extraction.tasks) refCounts.set(t.ref, (refCounts.get(t.ref) ?? 0) + 1);
  const newRefs = new Set(extraction.tasks.map((t) => t.ref));
  const existingIds = new Set(ctx.existingTasks.map((t) => t.id));
  const goalIds = new Set(ctx.goals.map((g) => g.id));

  const tasks: ProposedTask[] = extraction.tasks.map((t) => {
    const reviewReasons: string[] = [];

    let ownerId: string | null = null;
    if (t.owner_name === null) reviewReasons.push("AI found no owner. Check the note");
    else {
      const match = matchOwner(t.owner_name, ctx.team);
      if (match && "ambiguous" in match) reviewReasons.push(`"${t.owner_name}" matches more than one team member`);
      else if (match) {
        ownerId = match.member.id;
        if (match.byFirstNameOnly) reviewReasons.push(`Owner "${t.owner_name}" matched to ${match.member.name} by first name only`);
      } else reviewReasons.push(`"${t.owner_name}" is not in the team list`);
    }

    let due: string | null = null;
    if (t.due_date === null) reviewReasons.push("AI found no due date. Check the note");
    else if (!isValidIsoDate(t.due_date)) reviewReasons.push(`"${t.due_date}" is not a real date`);
    else if (t.due_date < ctx.meetingDate) reviewReasons.push(`Due date ${t.due_date} is before the meeting`);
    else due = t.due_date;

    let goalId: string | null = null;
    if (t.goal_id === null) reviewReasons.push("Not linked to a company goal");
    else if (goalIds.has(t.goal_id)) goalId = t.goal_id;
    else reviewReasons.push(`Goal "${t.goal_id}" does not exist`);

    const dependsOn: string[] = [];
    for (const dep of t.depends_on) {
      if (dep === t.ref) {
        reviewReasons.push("Task depends on itself");
        continue;
      }
      if (newRefs.has(dep) || existingIds.has(dep)) dependsOn.push(dep);
      else reviewReasons.push(`Dropped unknown dependency "${dep}"`);
    }

    if (t.confidence < lowConfidence) reviewReasons.push(`AI was unsure (confidence ${t.confidence.toFixed(2)})`);

    if (!normalisedNote.includes(normalise(t.source_quote))) reviewReasons.push("Quote not found in the note. The AI may have invented this task");
    if ((refCounts.get(t.ref) ?? 0) > 1) reviewReasons.push(`Duplicate task id ${t.ref} from the AI`);

    return { ref: t.ref, title: t.title, ownerId, due, goalId, dependsOn, sourceQuote: t.source_quote, confidence: t.confidence, reviewReasons };
  });

  const dueById = new Map<string, string | null>([
    ...tasks.map((t) => [t.ref, t.due] as const),
    ...ctx.existingTasks.map((t) => [t.id, t.due] as const),
  ]);
  for (const t of tasks) {
    if (!t.due) continue;
    for (const dep of t.dependsOn) {
      const depDue = dueById.get(dep);
      if (depDue && depDue > t.due) t.reviewReasons.push(`Due ${t.due}, but it depends on ${dep} which is due later (${depDue})`);
    }
  }

  const cycle = findCycle(new Map(tasks.map((t) => [t.ref, t.dependsOn.filter((d) => newRefs.has(d))])));
  if (cycle) {
    const label = `Circular dependency: ${cycle.join(" → ")}`;
    for (const t of tasks) if (cycle.includes(t.ref)) t.reviewReasons.push(label);
  }

  return tasks;
}
