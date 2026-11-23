import { existsSync, readFileSync } from "node:fs";
import { resolve } from "node:path";
import { parseArgs } from "node:util";
import { Client } from "@notionhq/client";
import { OpenRouterClient } from "./llm";
import { runPipeline } from "./pipeline";
import { findPreviousRun, sha256 } from "./runlog";
import { SetupError, UsageError, explainError, postAlert } from "./alerts";
import type { NotionPagesApi } from "./notion";
import type { MeetingContext } from "./schema";

if (existsSync(".env")) process.loadEnvFile(".env");

const { values } = parseArgs({
  options: {
    note: { type: "string" },
    context: { type: "string" },
    notion: { type: "boolean", default: false },
    force: { type: "boolean", default: false },
  },
});

const notePath = values.note;
const contextPath = values.context;
if (!notePath || !contextPath) {
  console.error("Usage: npm run extract -- --note <meeting.md> --context <context.json> [--notion] [--force]");
  process.exit(1);
}

function requireEnv(name: string): string {
  const value = process.env[name];
  if (!value) throw new SetupError(`${name} is not set. Copy .env.example to .env and fill it in.`);
  return value;
}

async function main(notePath: string, contextPath: string) {
  const note = readFileSync(notePath, "utf8");
  const runLogPath = resolve("runs", "runs.jsonl");

  const previous = findPreviousRun(runLogPath, sha256(note));
  if (previous && !values.force) {
    throw new UsageError(
      `This note was already turned into ${previous.output?.length ?? 0} tasks in run ${previous.runId} (${previous.startedAt.slice(0, 10)}). ` +
        `Running it again would create duplicate Proposed tasks. Add --force to run it anyway.`,
    );
  }

  const llm = new OpenRouterClient(requireEnv("OPENROUTER_API_KEY"));
  const notion = values.notion
    ? { api: new Client({ auth: requireEnv("NOTION_TOKEN") }) as unknown as NotionPagesApi, databaseId: requireEnv("NOTION_TASKS_DB_ID") }
    : undefined;

  const result = await runPipeline(
    {
      note,
      context: JSON.parse(readFileSync(contextPath, "utf8")) as MeetingContext,
      configDir: resolve("config"),
      runLogPath,
      outDir: resolve("out"),
    },
    { llm, notion },
  );

  console.log(result.review);
  console.log(`\nRun ${result.runId} · cost $${result.costUsd.toFixed(5)} · saved ${result.outFile}`);
  if (result.notionPageIds) console.log(`Created ${result.notionPageIds.size} Proposed tasks in Notion.`);
}

main(notePath, contextPath).catch(async (err) => {
  const message = explainError(err);
  console.error(message);
  // A usage mistake isn't an incident, so it doesn't page the alerts channel.
  if (!(err instanceof UsageError)) {
    await postAlert(process.env.SLACK_ALERTS_WEBHOOK_URL, message).catch(() => undefined);
  }
  process.exit(1);
});
