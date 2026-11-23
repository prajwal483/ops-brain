import type { ProposedTask } from "./schema";

export type Any = "any";

// A field's expected answer: one value, "any" (not scored), or a list of acceptable values.
export type Accept = string | null | Any | (string | null)[];
// Dependencies: one set, "any", or a list of acceptable sets.
export type AcceptDeps = string[] | Any | string[][];

export interface ExpectedTask {
  id: string;
  match: string[]; // lowercase keywords; all must appear in the predicted title
  not?: string[]; // keywords that must NOT appear in the title (keeps overlapping tasks apart)
  owner: Accept;
  due: Accept;
  goal: Accept;
  dependsOn: AcceptDeps; // expected ids or existing task ids
  expectFlag?: string; // a substring one of the task's reviewReasons must contain
}

export interface Expected {
  dev?: boolean; // true when the prompt was built against this note, so it is not held out
  tasks: ExpectedTask[];
  mustNotInclude?: string[][];
}

export const FIELDS = ["owner", "due", "goal", "dependsOn", "flag"] as const;
export type Field = (typeof FIELDS)[number];

export interface FieldScore {
  correct: number;
  scored: number;
}

export interface CaseScore {
  expectedCount: number;
  matchedCount: number;
  recall: number;
  extras: string[]; // titles of predicted tasks that matched no expected task
  parkedLeaks: string[]; // titles that hit a mustNotInclude set
  fields: Record<Field, FieldScore>;
  total: FieldScore;
  misses: string[];
}

const hasAll = (title: string, words: string[]) => {
  const t = title.toLowerCase();
  return words.every((w) => t.includes(w.toLowerCase()));
};

const matches = (title: string, e: ExpectedTask) => hasAll(title, e.match) && !(e.not ?? []).some((w) => title.toLowerCase().includes(w.toLowerCase()));

const sameSet = (a: string[], b: string[]) => {
  const x = new Set(a);
  const y = new Set(b);
  return x.size === y.size && [...x].every((v) => y.has(v));
};

const show = (v: unknown) => (Array.isArray(v) ? `[${v.join(", ")}]` : String(v));

const isDepsAlternatives = (want: AcceptDeps): want is string[][] => Array.isArray(want) && want.length > 0 && want.every(Array.isArray);

interface FieldResult {
  field: Field;
  ok: boolean;
  want: string;
  got: string;
}

// Scored fields of one expected task against one predicted task (or none, when the task was missed).
function fieldResults(e: ExpectedTask, p: ProposedTask | undefined, refToExp: (ref: string) => string): FieldResult[] {
  const out: FieldResult[] = [];
  const values: Record<"owner" | "due" | "goal", string | null | undefined> = { owner: p?.ownerId, due: p?.due, goal: p?.goalId };
  for (const f of ["owner", "due", "goal"] as const) {
    const want = e[f];
    if (want === "any") continue;
    const alts = Array.isArray(want) ? want : [want];
    const got = values[f];
    out.push({
      field: f,
      ok: p !== undefined && alts.includes(got as string | null),
      want: Array.isArray(want) ? `one of ${want.map(String).join(" | ")}` : String(want),
      got: String(got),
    });
  }
  if (e.dependsOn !== "any") {
    const sets = isDepsAlternatives(e.dependsOn) ? e.dependsOn : [e.dependsOn as string[]];
    const got = p ? p.dependsOn.map(refToExp) : [];
    out.push({
      field: "dependsOn",
      ok: p !== undefined && sets.some((s) => sameSet(s, got)),
      want: sets.length > 1 ? `one of ${sets.map(show).join(" | ")}` : show(sets[0]),
      got: show(got),
    });
  }
  if (e.expectFlag !== undefined) {
    const flag = e.expectFlag;
    out.push({
      field: "flag",
      ok: p !== undefined && p.reviewReasons.some((r) => r.includes(flag)),
      want: `a flag containing "${flag}"`,
      got: p && p.reviewReasons.length ? p.reviewReasons.map((r) => `"${r}"`).join(", ") : "no flags",
    });
  }
  return out;
}

export function scoreCase(predicted: ProposedTask[], expected: Expected): CaseScore {
  // Order-independent ref lookup used while choosing matches: a ref maps to an expected id
  // only when its title fits exactly one expected task.
  const provisional = new Map<string, string>();
  for (const p of predicted) {
    const hits = expected.tasks.filter((e) => matches(p.title, e));
    if (hits.length === 1) provisional.set(p.ref, hits[0].id);
  }

  // When several unused titles fit, take the one with the most correct fields; ties go to the earlier title.
  const used = new Set<number>();
  const expToPred = new Map<string, ProposedTask>();
  const refToExp = new Map<string, string>();
  for (const e of expected.tasks) {
    let best = -1;
    let bestCorrect = -1;
    predicted.forEach((p, idx) => {
      if (used.has(idx) || !matches(p.title, e)) return;
      const correct = fieldResults(e, p, (r) => provisional.get(r) ?? r).filter((r) => r.ok).length;
      if (correct > bestCorrect) {
        best = idx;
        bestCorrect = correct;
      }
    });
    if (best >= 0) {
      used.add(best);
      expToPred.set(e.id, predicted[best]);
      refToExp.set(predicted[best].ref, e.id);
    }
  }

  const fields = Object.fromEntries(FIELDS.map((f) => [f, { correct: 0, scored: 0 }])) as Record<Field, FieldScore>;
  const misses: string[] = [];

  for (const e of expected.tasks) {
    const p = expToPred.get(e.id);
    const results = fieldResults(e, p, (r) => refToExp.get(r) ?? r);
    // A missed task's scored fields all count as wrong, so missing a task can't raise accuracy.
    if (!p) misses.push(`${e.id}: not found (no predicted title has: ${e.match.join(", ")}); its ${results.length} scored field(s) count as wrong`);
    for (const r of results) {
      fields[r.field].scored++;
      if (r.ok) fields[r.field].correct++;
      else if (p) misses.push(`${e.id}: ${r.field} expected ${r.want} got ${r.got}`);
    }
  }

  const extras = predicted.filter((_, i) => !used.has(i)).map((p) => p.title);
  const parkedLeaks = predicted
    .filter((p) => (expected.mustNotInclude ?? []).some((set) => hasAll(p.title, set)))
    .map((p) => p.title);
  for (const t of parkedLeaks) misses.push(`parked item became a task: "${t}"`);

  const total = FIELDS.reduce((a, f) => ({ correct: a.correct + fields[f].correct, scored: a.scored + fields[f].scored }), { correct: 0, scored: 0 });
  const matchedCount = expToPred.size;
  return {
    expectedCount: expected.tasks.length,
    matchedCount,
    recall: expected.tasks.length ? matchedCount / expected.tasks.length : 1,
    extras,
    parkedLeaks,
    fields,
    total,
    misses,
  };
}
