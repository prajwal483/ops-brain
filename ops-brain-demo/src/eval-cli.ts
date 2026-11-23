import { cpSync, existsSync, mkdirSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve } from "node:path";
import { parseArgs } from "node:util";
import { LlmError, OpenRouterClient } from "./llm";
import { SetupError, UsageError, explainError } from "./alerts";
import { runPipeline } from "./pipeline";
import { loadModelsConfig, loadPrompt, routeFor } from "./config";
import { FIELDS, scoreCase, type CaseScore, type Expected } from "./eval";
import { sha256, type RunLog } from "./runlog";
import type { MeetingContext, ProposedTask } from "./schema";

if (existsSync(".env")) process.loadEnvFile(".env");

const { values } = parseArgs({
  options: { model: { type: "string" }, case: { type: "string" }, rescore: { type: "boolean", default: false } },
});

const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
const pct = (f: { correct: number; scored: number }) => (f.scored ? `${f.correct}/${f.scored}` : "-");
const today = () => new Date().toLocaleDateString("en-CA"); // local YYYY-MM-DD
const runLogPath = resolve("eval", "runs.jsonl");
const outDir = resolve("eval", "out");

interface Case {
  name: string;
  note: string;
  context: MeetingContext;
  expected: Expected;
}

interface Row {
  name: string;
  dev: boolean;
  status: "ok" | "rate-limited" | "error" | "no stored run";
  score?: CaseScore;
  error?: string;
  run?: RunLog;
}

function loadCases(): Case[] {
  const casesDir = resolve("eval", "cases");
  const names = readdirSync(casesDir).filter((n) => existsSync(join(casesDir, n, "expected.json")));
  const chosen = values.case ? names.filter((n) => n === values.case) : names;
  if (chosen.length === 0) throw new UsageError(`No such case "${values.case}". Available: ${names.join(", ")}`);
  return chosen.map((name) => {
    const dir = join(casesDir, name);
    return {
      name,
      // Read exactly as the pipeline input is read, so inputSha256 in the run log matches.
      note: readFileSync(join(dir, "note.md"), "utf8"),
      context: JSON.parse(readFileSync(join(dir, "context.json"), "utf8")) as MeetingContext,
      expected: JSON.parse(readFileSync(join(dir, "expected.json"), "utf8")) as Expected,
    };
  });
}

function configDirFor(model: string | undefined): string {
  const real = resolve("config");
  if (!model) return real;
  const dir = mkdtempSync(join(tmpdir(), "ob-eval-config-"));
  cpSync(join(real, "prompts"), join(dir, "prompts"), { recursive: true });
  const rules = loadModelsConfig(real).rules;
  writeFileSync(
    join(dir, "models.json"),
    JSON.stringify({ rules, jobs: { extract_tasks: { model, inputUsdPerMTok: 0, outputUsdPerMTok: 0 } } }, null, 2),
  );
  return dir;
}

function totals(label: string, rows: Row[]): string {
  const done = rows.filter((r) => r.score).map((r) => r.score!);
  const sum = (f: (s: CaseScore) => number) => done.reduce((a, s) => a + f(s), 0);
  const correct = sum((s) => s.total.correct);
  const scored = sum((s) => s.total.scored);
  return (
    `${label} (${rows.length} case${rows.length === 1 ? "" : "s"}): tasks found ${sum((s) => s.matchedCount)}/${sum((s) => s.expectedCount)}, ` +
    `fields correct ${correct}/${scored}${scored ? ` (${Math.round((correct / scored) * 100)}%)` : ""}, extras ${sum((s) => s.extras.length)}, ` +
    `parked leaks ${sum((s) => s.parkedLeaks.length)}${done.length < rows.length ? ` (${rows.length - done.length} case(s) did not complete)` : ""}`
  );
}

// Prints the table and, for a full run, writes eval/results/<model>.md.
function report(model: string, promptLabel: string, rows: Row[], meta: string[]): void {
  const header =
    "| case | set | tasks found/expected | extras | parked leaks | owner | due | goal | deps | flag | total |\n|---|---|---|---|---|---|---|---|---|---|---|";
  const lines = rows.map((r) => {
    const set = r.dev ? "dev" : "held out";
    const s = r.score;
    if (!s) return `| ${r.name} | ${set} | ${r.status}${r.error ? `: ${r.error.slice(0, 60).replace(/\|/g, "/")}` : ""} | | | | | | | | |`;
    return `| ${r.name} | ${set} | ${s.matchedCount}/${s.expectedCount} | ${s.extras.length} | ${s.parkedLeaks.length} | ${FIELDS.map((f) => pct(s.fields[f])).join(" | ")} | ${pct(s.total)} |`;
  });
  const heldOut = rows.filter((r) => !r.dev);
  const summary = [
    ...(heldOut.length && heldOut.length < rows.length ? [totals("Held out", heldOut)] : []),
    totals("All cases", rows),
  ];
  const missLines = rows.flatMap((r) => (r.score ? r.score.misses.map((m) => `- ${r.name} / ${m}`) : []));
  const extraLines = rows.flatMap((r) => (r.score ? r.score.extras.map((e) => `- ${r.name} / extra task: "${e}"`) : []));

  const table = [header, ...lines].join("\n");
  console.log(`\n${table}\n\n${summary.join("\n")}`);
  for (const m of [...missLines, ...extraLines]) console.log(m);

  const devCases = rows.filter((r) => r.dev).map((r) => r.name);
  const doc = [
    `# Eval: ${model}`,
    "",
    ...meta,
    `- Model: ${model}`,
    `- Prompt: ${promptLabel}`,
    `- Cases: ${rows.map((r) => r.name).join(", ")} (one run each)`,
    ...(devCases.length
      ? [`- Dev case (not held out; the prompt was built against it): ${devCases.join(", ")}. The other cases are held out.`]
      : []),
    "",
    table,
    "",
    ...summary.flatMap((s) => [s, ""]),
    "## Misses",
    "",
    ...(missLines.length ? missLines : ["None."]),
    "",
    "## Extra tasks",
    "",
    ...(extraLines.length ? extraLines : ["None."]),
    "",
  ].join("\n");
  if (values.case) {
    console.log("(single-case run: report not written)");
    return;
  }
  mkdirSync(resolve("eval", "results"), { recursive: true });
  const file = resolve("eval", "results", `${model.replace(/[^a-zA-Z0-9._-]+/g, "_")}.md`);
  writeFileSync(file, doc, "utf8");
  console.log(`\nReport: ${file}`);
}

async function liveRun(cases: Case[]): Promise<void> {
  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) throw new SetupError("OPENROUTER_API_KEY is not set (put it in .env).");
  const configDir = configDirFor(values.model);
  try {
    const model = routeFor(loadModelsConfig(configDir), "extract_tasks").model;
    const prompt = loadPrompt(configDir, "extract-tasks");
    const llm = new OpenRouterClient(apiKey);
    console.log(`Model: ${model} · prompt ${prompt.id} v${prompt.version}`);

    const rows: Row[] = [];
    for (const c of cases) {
      const input = { note: c.note, context: c.context, configDir, runLogPath, outDir };
      const dev = c.expected.dev === true;
      let row: Row | undefined;
      for (let attempt = 0; attempt <= 3 && !row; attempt++) {
        console.log(`Running ${c.name}${attempt ? ` (retry ${attempt})` : ""}...`);
        try {
          const result = await runPipeline(input, { llm });
          row = { name: c.name, dev, status: "ok", score: scoreCase(result.tasks, c.expected) };
        } catch (err) {
          if (err instanceof LlmError && err.status === 429) {
            if (attempt === 3) row = { name: c.name, dev, status: "rate-limited" };
            else {
              console.log("  rate-limited (429), waiting 20s");
              await sleep(20_000);
            }
          } else row = { name: c.name, dev, status: "error", error: (err as Error).message };
        }
      }
      rows.push(row!);
    }
    report(model, `${prompt.id} v${prompt.version}`, rows, [`- Date: ${today()}`]);
  } finally {
    if (configDir !== resolve("config")) rmSync(configDir, { recursive: true, force: true });
  }
}

// Re-scores the latest successful stored run per model and case. Makes no model calls.
function rescore(cases: Case[]): void {
  if (!existsSync(runLogPath)) throw new UsageError(`No stored runs: ${runLogPath} does not exist. Run "npm run eval" first.`);
  const runs = readFileSync(runLogPath, "utf8")
    .split("\n")
    .filter((l) => l.trim())
    .map((l) => JSON.parse(l) as RunLog)
    .filter((r) => r.error === null && r.output !== null);
  const models = [...new Set(runs.map((r) => r.model))].filter((m) => !values.model || m === values.model);
  if (models.length === 0) throw new UsageError(`No successful stored runs${values.model ? ` for ${values.model}` : ""} in ${runLogPath}`);

  for (const model of models) {
    console.log(`\nModel: ${model} (re-scoring stored outputs)`);
    const rows: Row[] = cases.map((c) => {
      const hash = sha256(c.note);
      const run = runs
        .filter((r) => r.model === model && r.inputSha256 === hash)
        .sort((a, b) => a.startedAt.localeCompare(b.startedAt))
        .at(-1);
      const dev = c.expected.dev === true;
      if (!run) return { name: c.name, dev, status: "no stored run" };
      const outFile = join(outDir, `${run.runId}.json`);
      if (!existsSync(outFile)) return { name: c.name, dev, status: "error", error: `missing ${run.runId}.json`, run };
      const tasks = (JSON.parse(readFileSync(outFile, "utf8")) as { tasks: ProposedTask[] }).tasks;
      console.log(`  ${c.name}: ${run.runId}`);
      return { name: c.name, dev, status: "ok", score: scoreCase(tasks, c.expected), run };
    });
    const used = rows.flatMap((r) => (r.run ? [r.run] : []));
    const prompts = [...new Set(used.map((r) => `${r.promptId} v${r.promptVersion}`))].join(", ") || "unknown";
    const runDates = [...new Set(used.map((r) => r.startedAt.slice(0, 10)))].join(", ") || "unknown";
    report(model, prompts, rows, [
      `- Original run date: ${runDates} (runs: ${used.map((r) => r.runId).join(", ")})`,
      `- Re-scored from stored outputs on ${today()} with the current expected answers and scoring (no model calls)`,
    ]);
  }
}

async function main() {
  const cases = loadCases();
  if (values.rescore) rescore(cases);
  else await liveRun(cases);
}

main().catch((err) => {
  console.error(explainError(err));
  process.exit(1);
});
