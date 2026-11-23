import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { loadModelsConfig, loadPrompt, routeFor } from "./config";
import { LlmError, costUsd, type LlmClient } from "./llm";
import { ExtractionError, extractTasks, type ExtractionResult } from "./extract";
import { resolveTasks } from "./resolve";
import { appendRunLog, newRunId, sha256 } from "./runlog";
import { formatReview } from "./review";
import { writeProposedTasks, type NotionPagesApi } from "./notion";
import type { MeetingContext, ProposedTask } from "./schema";

const JOB = "extract_tasks";

export interface PipelineInput {
  note: string;
  context: MeetingContext;
  configDir: string;
  runLogPath: string;
  outDir: string;
}

export interface PipelineDeps {
  llm: LlmClient;
  notion?: { api: NotionPagesApi; databaseId: string };
  now?: () => Date;
}

export interface PipelineResult {
  runId: string;
  tasks: ProposedTask[];
  review: string;
  costUsd: number;
  outFile: string;
  notionPageIds?: Map<string, string>;
}

export async function runPipeline(input: PipelineInput, deps: PipelineDeps): Promise<PipelineResult> {
  const startedAt = deps.now ? deps.now() : new Date();
  const runId = newRunId(startedAt);
  const prompt = loadPrompt(input.configDir, "extract-tasks");
  const models = loadModelsConfig(input.configDir);
  const route = routeFor(models, JOB);
  const base = {
    runId,
    job: JOB,
    startedAt: startedAt.toISOString(),
    promptId: prompt.id,
    promptVersion: prompt.version,
    inputSha256: sha256(input.note),
    inputPreview: input.note.slice(0, 200),
    // Always "pending" here: review outcomes go to runs/reviews.jsonl keyed by runId (npm run review).
    reviewStatus: "pending" as const,
  };

  let result: ExtractionResult | undefined;
  let tasks: ProposedTask[] | undefined;
  try {
    result = await extractTasks(input.note, input.context, { llm: deps.llm, route, prompt });
    tasks = resolveTasks(result.extraction, input.context, input.note, { lowConfidence: models.rules?.lowConfidence });
    const cost = costUsd(route, result.inputTokens, result.outputTokens);

    mkdirSync(input.outDir, { recursive: true });
    const outFile = join(input.outDir, `${runId}.json`);
    writeFileSync(outFile, JSON.stringify({ runId, meeting: input.context.meetingTitle, tasks }, null, 2), "utf8");

    const notionPageIds = deps.notion
      ? await writeProposedTasks(deps.notion.api, deps.notion.databaseId, tasks, input.context, runId)
      : undefined;

    appendRunLog(input.runLogPath, {
      ...base,
      model: result.model,
      attempts: result.attempts,
      inputTokens: result.inputTokens,
      outputTokens: result.outputTokens,
      costUsd: cost,
      output: tasks,
      error: null,
    });
    return { runId, tasks, review: formatReview(tasks, input.context), costUsd: cost, outFile, notionPageIds };
  } catch (err) {
    const used = result ?? (err instanceof ExtractionError || err instanceof LlmError ? err.usage : undefined);
    appendRunLog(input.runLogPath, {
      ...base,
      model: used?.model ?? route.model,
      attempts: used?.attempts ?? 0,
      inputTokens: used?.inputTokens ?? 0,
      outputTokens: used?.outputTokens ?? 0,
      costUsd: used ? costUsd(route, used.inputTokens, used.outputTokens) : 0,
      output: tasks ?? null,
      error: (err as Error).message,
    });
    throw err;
  }
}
