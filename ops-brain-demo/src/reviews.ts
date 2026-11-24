import { appendFileSync, existsSync, mkdirSync, readFileSync } from "node:fs";
import { dirname } from "node:path";
import type { RunLog } from "./runlog";
import { UsageError } from "./alerts";

export type TaskOutcome = {
  ref: string;
  outcome: "approved" | "edited" | "rejected";
  editedFields?: Record<string, string>;
};

// One line per review in runs/reviews.jsonl. In v1 this is written automatically
// when a person approves, edits or rejects in Notion and Slack.
export interface ReviewEvent {
  runId: string;
  reviewedAt: string;
  reviewer: string;
  decisions: TaskOutcome[];
}

export const EDITABLE_FIELDS = ["title", "owner", "due", "goal", "dependsOn"] as const;

function splitList(text: string | undefined): string[] {
  return (text ?? "").split(",").map((s) => s.trim()).filter(Boolean);
}

export function parseDecisions(
  args: { approve?: string; reject?: string; edit?: string[] },
  refs: string[],
  runId = "this run",
): TaskOutcome[] {
  const known = new Set(refs);
  const decided = new Map<string, TaskOutcome>();
  const claim = (outcome: TaskOutcome) => {
    if (!known.has(outcome.ref)) throw new UsageError(`Task ${outcome.ref} is not in run ${runId}`);
    if (decided.has(outcome.ref)) throw new UsageError(`Task ${outcome.ref} was given more than one decision`);
    decided.set(outcome.ref, outcome);
  };

  for (const ref of splitList(args.reject)) claim({ ref, outcome: "rejected" });

  for (const spec of args.edit ?? []) {
    const colon = spec.indexOf(":");
    const ref = (colon === -1 ? spec : spec.slice(0, colon)).trim();
    const pairs = colon === -1 ? [] : splitList(spec.slice(colon + 1));
    if (pairs.length === 0) throw new UsageError(`Edit "${spec}" needs fields, e.g. T3:due=2026-12-12,owner=aditya`);
    const editedFields: Record<string, string> = {};
    for (const pair of pairs) {
      const eq = pair.indexOf("=");
      if (eq === -1) throw new UsageError(`Edit "${spec}": "${pair}" should look like field=value`);
      const field = pair.slice(0, eq).trim();
      if (!(EDITABLE_FIELDS as readonly string[]).includes(field)) {
        throw new UsageError(`Can't edit "${field}". Fields you can edit: ${EDITABLE_FIELDS.join(", ")}`);
      }
      editedFields[field] = pair.slice(eq + 1).trim();
    }
    claim({ ref, outcome: "edited", editedFields });
  }

  if (args.approve?.trim().toLowerCase() === "all") {
    for (const ref of refs) if (!decided.has(ref)) decided.set(ref, { ref, outcome: "approved" });
  } else {
    for (const ref of splitList(args.approve)) claim({ ref, outcome: "approved" });
  }

  const missing = refs.filter((r) => !decided.has(r));
  if (missing.length > 0) {
    throw new UsageError(`No decision for ${missing.join(", ")}. Use --approve, --edit or --reject (or --approve all)`);
  }
  return refs.map((r) => decided.get(r)!);
}

export function appendReviewEvent(path: string, event: ReviewEvent): void {
  mkdirSync(dirname(path), { recursive: true });
  appendFileSync(path, JSON.stringify(event) + "\n", "utf8");
}

function readJsonl<T>(path: string): T[] {
  if (!existsSync(path)) return [];
  return readFileSync(path, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as T);
}

// runId "last" means the most recent run that produced tasks.
export function findRun(runLogPath: string, runId: string): RunLog {
  const runs = readJsonl<RunLog>(runLogPath);
  if (runId === "last") {
    const latest = runs.filter((r) => r.output !== null).pop();
    if (!latest) throw new UsageError("There is no run with tasks to review yet. Run `npm run extract` first");
    return latest;
  }
  const run = runs.find((r) => r.runId === runId);
  if (!run) throw new UsageError(`Run ${runId} was not found in the run log`);
  if (run.output === null) {
    throw new UsageError(`Run ${runId} failed${run.error ? ` (${run.error})` : ""}, so there is nothing to review`);
  }
  return run;
}

export function summarizeReviews(reviewsPath: string) {
  const latest = new Map<string, ReviewEvent>();
  for (const e of readJsonl<ReviewEvent>(reviewsPath)) latest.set(e.runId, e); // later lines replace earlier ones
  const s = {
    runs: latest.size,
    tasks: 0,
    approved: 0,
    edited: 0,
    rejected: 0,
    approvedUneditedPct: 0,
    editedFieldCounts: {} as Record<string, number>,
  };
  for (const e of latest.values()) {
    for (const d of e.decisions) {
      s.tasks++;
      s[d.outcome]++;
      for (const f of Object.keys(d.editedFields ?? {})) s.editedFieldCounts[f] = (s.editedFieldCounts[f] ?? 0) + 1;
    }
  }
  s.approvedUneditedPct = s.tasks === 0 ? 0 : Math.round((s.approved / s.tasks) * 1000) / 10;
  return s;
}
