import type { ModelRoute } from "./config";

export interface LlmRequest {
  model: string;
  system: string;
  user: string;
}

export interface LlmResponse {
  text: string;
  inputTokens: number;
  outputTokens: number;
  model: string;
}

export interface LlmClient {
  complete(req: LlmRequest): Promise<LlmResponse>;
}

// Token use so far, attached when a later attempt fails, so the run log still records the spend.
export interface LlmUsage {
  model: string;
  attempts: number;
  inputTokens: number;
  outputTokens: number;
}

export class LlmError extends Error {
  usage?: LlmUsage;
  constructor(message: string, public status: number) {
    super(message);
  }
}

// One adapter for every provider: OpenRouter exposes all models behind one
// OpenAI-compatible endpoint, so switching models is a config/models.json edit.
export class OpenRouterClient implements LlmClient {
  constructor(private apiKey: string, private fetchFn: typeof fetch = fetch, private timeoutMs = 180_000) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    type Body = {
      model?: string;
      choices?: { message?: { content?: unknown } }[];
      usage?: { prompt_tokens?: number; completion_tokens?: number };
    };
    let body: Body;
    // Reading the body can time out too, so it sits inside the same error handling as the request.
    try {
      const res = await this.fetchFn("https://openrouter.ai/api/v1/chat/completions", {
        method: "POST",
        headers: { Authorization: `Bearer ${this.apiKey}`, "Content-Type": "application/json" },
        body: JSON.stringify({
          model: req.model,
          messages: [
            { role: "system", content: req.system },
            { role: "user", content: req.user },
          ],
          response_format: { type: "json_object" },
          temperature: 0,
        }),
        signal: AbortSignal.timeout(this.timeoutMs),
      });
      if (!res.ok) throw new LlmError(`Model provider returned ${res.status}: ${(await res.text()).slice(0, 200)}`, res.status);
      const raw = await res.text();
      try {
        body = JSON.parse(raw) as Body;
      } catch {
        throw new LlmError(`Model provider returned something that isn't JSON: ${raw.slice(0, 200)}`, 502);
      }
    } catch (e) {
      if (e instanceof LlmError) throw e;
      const name = (e as Error).name;
      if (name === "TimeoutError" || name === "AbortError") throw new LlmError("The model took too long to answer", 408);
      throw new LlmError(`Could not reach the model provider: ${(e as Error).message}`, 0);
    }
    const text = body.choices?.[0]?.message?.content;
    if (typeof text !== "string") {
      throw new LlmError(`Model provider returned no answer: ${JSON.stringify(body).slice(0, 200)}`, 502);
    }
    return {
      text,
      inputTokens: body.usage?.prompt_tokens ?? 0,
      outputTokens: body.usage?.completion_tokens ?? 0,
      model: body.model ?? req.model,
    };
  }
}

export function costUsd(route: ModelRoute, inputTokens: number, outputTokens: number): number {
  return (inputTokens * route.inputUsdPerMTok + outputTokens * route.outputUsdPerMTok) / 1_000_000;
}
