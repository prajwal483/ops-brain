import { readFileSync } from "node:fs";
import { join } from "node:path";

export interface ModelRoute {
  model: string;
  inputUsdPerMTok: number;
  outputUsdPerMTok: number;
}

export interface ModelsConfig {
  rules?: { lowConfidence?: number };
  jobs: Record<string, ModelRoute>;
}

export interface PromptConfig {
  id: string;
  version: string;
  text: string;
}

export function loadModelsConfig(configDir: string): ModelsConfig {
  return JSON.parse(readFileSync(join(configDir, "models.json"), "utf8")) as ModelsConfig;
}

export function routeFor(config: ModelsConfig, job: string): ModelRoute {
  const route = config.jobs[job];
  if (!route) throw new Error(`No model is set for the job "${job}". Add it to config/models.json.`);
  return route;
}

export function loadPrompt(configDir: string, name: string): PromptConfig {
  const raw = readFileSync(join(configDir, "prompts", `${name}.md`), "utf8").replace(/\r\n/g, "\n");
  const match = raw.match(/^---\n([\s\S]*?)\n---\n([\s\S]*)$/);
  if (!match) throw new Error(`Prompt file ${name}.md is missing its --- header ---`);
  const meta: Record<string, string> = {};
  for (const line of match[1].split("\n")) {
    const i = line.indexOf(":");
    if (i > 0) meta[line.slice(0, i).trim()] = line.slice(i + 1).trim();
  }
  if (!meta.id || !meta.version) throw new Error(`Prompt file ${name}.md needs "id" and "version" in its header`);
  return { id: meta.id, version: meta.version, text: match[2].trim() };
}

export function renderPrompt(template: string, vars: Record<string, string>): string {
  const out = template.replace(/\{\{(\w+)\}\}/g, (whole, key: string) => (key in vars ? vars[key] : whole));
  const missing = out.match(/\{\{\w+\}\}/g);
  if (missing) throw new Error(`Prompt is missing values for: ${missing.join(", ")}`);
  return out;
}
