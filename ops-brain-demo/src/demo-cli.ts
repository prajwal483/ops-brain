// `npm run demo`: a guided walkthrough for showing the demo live.
// Each step runs the real commands (extract, review) as child processes, prints a
// live timer while the model thinks, and pauses for Enter so the presenter can talk.
import { existsSync, readFileSync } from "node:fs";
import { spawn } from "node:child_process";
import { createInterface } from "node:readline/promises";
import { resolve } from "node:path";
import { loadModelsConfig, routeFor } from "./config";
import type { RunLog } from "./runlog";

const NOTE = "fixtures/meeting-2026-11-17-launch-sync.md";
const CONTEXT = "fixtures/context.json";
const interactive = Boolean(process.stdin.isTTY);
const rl = createInterface({ input: process.stdin, output: process.stdout });

const bold = (s: string) => `\x1b[1m${s}\x1b[0m`;
const cyan = (s: string) => `\x1b[36m${s}\x1b[0m`;
const dim = (s: string) => `\x1b[2m${s}\x1b[0m`;

async function pause(next: string): Promise<void> {
  if (!interactive) return;
  await rl.question(dim(`\n↵ Enter: ${next}`));
}

function heading(n: number, title: string, command?: string): void {
  console.log(`\n${cyan("━".repeat(64))}\n${bold(`STEP ${n} · ${title}`)}`);
  if (command) console.log(dim(`$ ${command}`));
  console.log(cyan("━".repeat(64)));
}

// Runs one of the project's own CLIs and shows a live timer until it finishes.
function runCli(script: string, args: string[], timerLabel?: string): Promise<number> {
  return new Promise((done) => {
    const child = spawn(process.execPath, ["--import", "tsx", script, ...args], { stdio: ["ignore", "pipe", "pipe"] });
    let output = "";
    child.stdout.on("data", (d) => (output += d));
    child.stderr.on("data", (d) => (output += d));
    const started = Date.now();
    const timer = timerLabel
      ? setInterval(() => process.stdout.write(`\r⏳ ${timerLabel} ${Math.round((Date.now() - started) / 1000)}s `), 1000)
      : undefined;
    child.on("close", (code) => {
      if (timer) {
        clearInterval(timer);
        process.stdout.write(`\r✅ Done in ${Math.round((Date.now() - started) / 1000)}s${" ".repeat(30)}\n\n`);
      }
      process.stdout.write(output);
      done(code ?? 1);
    });
  });
}

function latestRun(): RunLog | null {
  const path = resolve("runs", "runs.jsonl");
  if (!existsSync(path)) return null;
  const runs = readFileSync(path, "utf8").split("\n").filter((l) => l.trim()).map((l) => JSON.parse(l) as RunLog);
  return runs.filter((r) => r.output !== null).pop() ?? null;
}

// The presenter decides each flagged task live; clean tasks are approved.
async function collectDecisions(run: RunLog): Promise<string[]> {
  const approve: string[] = [];
  const reject: string[] = [];
  const edits: string[] = [];
  for (const t of run.output ?? []) {
    if (t.reviewReasons.length === 0 || !interactive) {
      approve.push(t.ref);
      continue;
    }
    console.log(`\n${bold(`${t.ref}  ${t.title}`)}`);
    for (const r of t.reviewReasons) console.log(`   ⚠ ${r}`);
    const answer = (await rl.question("   [a]pprove · [e]dit · [r]eject (Enter = approve): ")).trim().toLowerCase();
    if (answer.startsWith("r")) reject.push(t.ref);
    else if (answer.startsWith("e")) {
      const fix = (await rl.question("   field=value, e.g. goal=G1 or due=2026-12-12 or owner=aditya: ")).trim();
      if (fix.includes("=")) edits.push(`${t.ref}:${fix}`);
      else approve.push(t.ref);
    } else approve.push(t.ref);
  }
  const args = ["--run", run.runId];
  if (approve.length) args.push("--approve", approve.join(","));
  if (reject.length) args.push("--reject", reject.join(","));
  for (const e of edits) args.push("--edit", e);
  return args;
}

async function main(): Promise<void> {
  const model = routeFor(loadModelsConfig(resolve("config")), "extract_tasks").model;
  console.log(bold("\nOps Brain: meeting note → proposed, dependency-linked tasks"));
  console.log(dim(`Model: ${model} via OpenRouter · all data is fictional`));

  await pause("show the meeting note");
  heading(1, "The input: a real-sounding Hinglish meeting note", `cat ${NOTE}`);
  console.log(readFileSync(NOTE, "utf8"));

  await pause("turn it into proposed tasks");
  heading(2, "Turn the note into Proposed tasks", `npm run extract -- --note ${NOTE} --context ${CONTEXT} --force`);
  const code = await runCli("src/cli.ts", ["--note", NOTE, "--context", CONTEXT, "--force"], "Model is reading the note…");
  if (code !== 0) {
    console.log(`\nThe model call failed (see above). A saved real run is in examples/demo-session.txt.`);
    rl.close();
    process.exit(1);
  }

  await pause("run the same note again");
  heading(3, "Run the same note again: no duplicate tasks", `npm run extract -- --note ${NOTE} --context ${CONTEXT}`);
  await runCli("src/cli.ts", ["--note", NOTE, "--context", CONTEXT]);

  await pause("review the flagged tasks (you decide)");
  heading(4, "A person reviews: nothing is assigned without approval", "npm run review -- --run <run> --approve … --edit … --reject …");
  const run = latestRun();
  if (!run) throw new Error("No run found to review");
  const reviewArgs = await collectDecisions(run);
  console.log(dim(`\n$ npm run review -- ${reviewArgs.join(" ")}`));
  await runCli("src/review-cli.ts", reviewArgs);

  await pause("show the approval rate");
  heading(5, `Approval rate (the PRD's "80% approved without edits" metric)`, "npm run review -- --stats");
  await runCli("src/review-cli.ts", ["--stats"]);

  await pause("show what was logged");
  heading(6, "Every run is logged: prompt version, model, tokens, cost", "runs/runs.jsonl (latest line)");
  const { runId, promptVersion, model: usedModel, attempts, inputTokens, outputTokens, costUsd } = run;
  console.log(JSON.stringify({ runId, promptVersion, model: usedModel, attempts, inputTokens, outputTokens, costUsd, tasks: run.output?.length }, null, 2));

  console.log(bold("\nDone. Code, tests and the accuracy eval: github.com/prajwal483/ops-brain\n"));
  rl.close();
}

main().catch((err) => {
  console.error(`\n${(err as Error).message}`);
  rl.close();
  process.exit(1);
});
