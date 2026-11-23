import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { UsageError, explainError, postAlert } from "./alerts";
import { appendReviewEvent, findRun, parseDecisions, summarizeReviews } from "./reviews";

if (existsSync(".env")) process.loadEnvFile(".env");

const USAGE =
  "Usage: npm run review -- --run <runId> [--approve T1,T4|all] [--reject T2] [--edit T3:due=2026-12-12] [--reviewer name]  or  npm run review -- --stats";

function parse(argv: string[]) {
  try {
    return parseArgs({
      args: argv,
      options: {
        run: { type: "string" },
        approve: { type: "string" },
        reject: { type: "string" },
        edit: { type: "string", multiple: true },
        reviewer: { type: "string" },
        stats: { type: "boolean", default: false },
      },
    });
  } catch (err) {
    throw new UsageError(`${(err as Error).message}\n${USAGE}`);
  }
}

function main(argv: string[]) {
  const { values } = parse(argv);
  const runLogPath = resolve("runs", "runs.jsonl");
  const reviewsPath = resolve("runs", "reviews.jsonl");

  if (values.stats) {
    const s = summarizeReviews(reviewsPath);
    if (s.tasks === 0) {
      console.log("No reviews recorded yet.");
      return;
    }
    const top = Object.entries(s.editedFieldCounts).sort((a, b) => b[1] - a[1])[0];
    console.log(
      `Reviewed ${s.tasks} task${s.tasks === 1 ? "" : "s"} across ${s.runs} run${s.runs === 1 ? "" : "s"}: ${s.approvedUneditedPct.toFixed(1)}% approved without edits (target 80%).` +
        (top ? ` Most-edited field: ${top[0]} (${top[1]}).` : ""),
    );
    return;
  }

  if (!values.run) {
    console.error(USAGE);
    process.exit(1);
  }
  const run = findRun(runLogPath, values.run);
  if (run.error) console.log(`Note: run ${run.runId} had an error: Notion write failed, but tasks were extracted (${run.error}).`);
  const decisions = parseDecisions(
    { approve: values.approve, reject: values.reject, edit: values.edit },
    run.output!.map((t) => t.ref),
    run.runId,
  );
  appendReviewEvent(reviewsPath, {
    runId: run.runId,
    reviewedAt: new Date().toISOString(),
    reviewer: values.reviewer ?? process.env.USERNAME ?? process.env.USER ?? "unknown",
    decisions,
  });

  const count = (o: string) => decisions.filter((d) => d.outcome === o).length;
  const fields = [...new Set(decisions.flatMap((d) => Object.keys(d.editedFields ?? {})))];
  console.log(
    `Run ${run.runId} reviewed: ${count("approved")} approved, ${count("edited")} edited` +
      `${fields.length ? ` (${fields.join(", ")})` : ""}, ${count("rejected")} rejected.`,
  );
}

try {
  main(process.argv.slice(2));
} catch (err) {
  const message = explainError(err);
  console.error(message);
  // Typos in the command shouldn't page the alerts channel.
  if (!(err instanceof UsageError)) await postAlert(process.env.SLACK_ALERTS_WEBHOOK_URL, message).catch(() => undefined);
  process.exit(1);
}
