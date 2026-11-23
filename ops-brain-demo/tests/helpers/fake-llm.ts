import type { LlmClient, LlmRequest, LlmResponse } from "../../src/llm";

export class FakeLlmClient implements LlmClient {
  calls: LlmRequest[] = [];

  constructor(private responses: string[]) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    this.calls.push(req);
    const text = this.responses.shift();
    if (text === undefined) throw new Error("FakeLlmClient: no more responses queued");
    return { text, inputTokens: 1000, outputTokens: 200, model: req.model };
  }
}
