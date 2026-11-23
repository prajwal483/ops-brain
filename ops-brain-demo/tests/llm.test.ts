import { describe, it, expect, vi } from "vitest";
import { LlmError, OpenRouterClient, costUsd } from "../src/llm";

describe("OpenRouterClient", () => {
  it("sends system + user messages and returns text and token usage", async () => {
    const fetchFn = vi.fn(async () =>
      new Response(
        JSON.stringify({
          model: "anthropic/claude-haiku-5.5",
          choices: [{ message: { content: '{"tasks":[]}' } }],
          usage: { prompt_tokens: 1200, completion_tokens: 300 },
        }),
        { status: 200 },
      ),
    );
    const client = new OpenRouterClient("sk-test", fetchFn as unknown as typeof fetch);

    const res = await client.complete({ model: "anthropic/claude-haiku-5.5", system: "SYS", user: "USER" });

    expect(res).toEqual({ text: '{"tasks":[]}', inputTokens: 1200, outputTokens: 300, model: "anthropic/claude-haiku-5.5" });
    const [url, init] = fetchFn.mock.calls[0] as unknown as [string, RequestInit];
    expect(url).toBe("https://openrouter.ai/api/v1/chat/completions");
    const body = JSON.parse(init.body as string);
    expect(body.messages).toEqual([
      { role: "system", content: "SYS" },
      { role: "user", content: "USER" },
    ]);
    expect(body.response_format).toEqual({ type: "json_object" });
    expect((init.headers as Record<string, string>).Authorization).toBe("Bearer sk-test");
  });

  it("throws LlmError carrying the HTTP status", async () => {
    const fetchFn = vi.fn(async () => new Response("bad key", { status: 401 }));
    const client = new OpenRouterClient("sk-bad", fetchFn as unknown as typeof fetch);
    await expect(client.complete({ model: "m", system: "s", user: "u" })).rejects.toMatchObject({ status: 401 });
    await expect(client.complete({ model: "m", system: "s", user: "u" })).rejects.toBeInstanceOf(LlmError);
  });
});

describe("OpenRouterClient edge cases", () => {
  const call = (fetchFn: unknown) =>
    new OpenRouterClient("k", fetchFn as typeof fetch).complete({ model: "m", system: "s", user: "u" });

  it("wraps network failures as LlmError status 0", async () => {
    await expect(call(vi.fn(async () => { throw new Error("offline"); }))).rejects.toMatchObject({ status: 0 });
  });
  it.each(["TimeoutError", "AbortError"])("turns a %s into a 408 LlmError", async (name) => {
    const fetchFn = vi.fn(async () => { throw Object.assign(new Error("aborted"), { name }); });
    await expect(call(fetchFn)).rejects.toMatchObject({ status: 408, message: "The model took too long to answer" });
  });
  it("uses a configurable timeout", async () => {
    const fetchFn = vi.fn(async (_u: unknown, init?: RequestInit) => {
      await new Promise((r) => setTimeout(r, 50));
      if (init?.signal?.aborted) throw Object.assign(new Error("t"), { name: "TimeoutError" });
      return new Response("{}", { status: 200 });
    });
    const client = new OpenRouterClient("k", fetchFn as unknown as typeof fetch, 5);
    await expect(client.complete({ model: "m", system: "s", user: "u" })).rejects.toMatchObject({ status: 408 });
  });
  it("turns a timeout while reading the body into a 408 LlmError", async () => {
    const timeout = () => Promise.reject(Object.assign(new Error("body read timed out"), { name: "TimeoutError" }));
    const res = { ok: true, status: 200, json: timeout, text: timeout };
    await expect(call(vi.fn(async () => res))).rejects.toMatchObject({ status: 408, message: "The model took too long to answer" });
  });
  it("turns a 200 with a non-JSON body into a 502 LlmError", async () => {
    const err = await call(vi.fn(async () => new Response("<html>Bad gateway</html>", { status: 200 }))).catch((e) => e);
    expect(err).toBeInstanceOf(LlmError);
    expect(err).toMatchObject({ status: 502, message: "Model provider returned something that isn't JSON: <html>Bad gateway</html>" });
  });
  it("rejects a 200 with empty choices", async () => {
    await expect(call(vi.fn(async () => new Response(JSON.stringify({ choices: [] }), { status: 200 })))).rejects.toMatchObject({ status: 502 });
  });
  it("rejects a 200 carrying an error body", async () => {
    const body = JSON.stringify({ error: { message: "no such model", code: 404 } });
    await expect(call(vi.fn(async () => new Response(body, { status: 200 })))).rejects.toMatchObject({ status: 502 });
  });
});

describe("costUsd", () => {
  it("prices tokens per million", () => {
    expect(costUsd({ model: "m", inputUsdPerMTok: 1, outputUsdPerMTok: 5 }, 8000, 2000)).toBeCloseTo(0.018, 6);
  });
});
