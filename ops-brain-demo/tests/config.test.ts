import { describe, it, expect } from "vitest";
import { mkdtempSync, mkdirSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { loadModelsConfig, loadPrompt, renderPrompt, routeFor } from "../src/config";

function tempConfig(): string {
  const dir = mkdtempSync(join(tmpdir(), "ob-config-"));
  mkdirSync(join(dir, "prompts"));
  return dir;
}

describe("loadPrompt", () => {
  it("reads id, version and body from the header", () => {
    const dir = tempConfig();
    writeFileSync(join(dir, "prompts", "demo.md"), "---\nid: demo\nversion: 3\n---\nHello {{name}}\n");
    expect(loadPrompt(dir, "demo")).toEqual({ id: "demo", version: "3", text: "Hello {{name}}" });
  });

  it("handles Windows line endings", () => {
    const dir = tempConfig();
    writeFileSync(join(dir, "prompts", "demo.md"), "---\r\nid: demo\r\nversion: 1\r\n---\r\nBody\r\n");
    expect(loadPrompt(dir, "demo").text).toBe("Body");
  });

  it("rejects a file without a header", () => {
    const dir = tempConfig();
    writeFileSync(join(dir, "prompts", "demo.md"), "Just a body");
    expect(() => loadPrompt(dir, "demo")).toThrow(/missing its --- header/);
  });
});

describe("renderPrompt", () => {
  it("fills in placeholders", () => {
    expect(renderPrompt("Hi {{who}}, today is {{day}}", { who: "Riya", day: "Tue" })).toBe("Hi Riya, today is Tue");
  });

  it("names any placeholder left unfilled", () => {
    expect(() => renderPrompt("Hi {{who}}", {})).toThrow(/missing values for: \{\{who\}\}/);
  });
});

describe("model routing", () => {
  it("loads models.json and returns the route for a job", () => {
    const dir = tempConfig();
    writeFileSync(join(dir, "models.json"), JSON.stringify({ jobs: { extract_tasks: { model: "x/y", inputUsdPerMTok: 1, outputUsdPerMTok: 5 } } }));
    expect(routeFor(loadModelsConfig(dir), "extract_tasks").model).toBe("x/y");
  });

  it("explains how to fix a missing job", () => {
    expect(() => routeFor({ jobs: {} }, "extract_tasks")).toThrow(/config\/models.json/);
  });
});
