export interface ChatTurn { role: "user" | "assistant"; content: string }
export interface LLMRequest { system: string; messages: ChatTurn[]; maxTokens?: number }
export interface LLMClient { complete(req: LLMRequest, signal?: AbortSignal): Promise<string> }

/** Anthropic Messages API over fetch. Key and model come from server-side config only. */
export class AnthropicClient implements LLMClient {
  constructor(private cfg: { apiKey: string; model: string; baseUrl?: string; timeoutMs?: number }) {
    if (!cfg.apiKey) throw new Error("AnthropicClient: apiKey is required");
    if (!cfg.model) throw new Error("AnthropicClient: model is required");
  }
  async complete(req: LLMRequest, signal?: AbortSignal): Promise<string> {
    const ctrl = new AbortController();
    const timer = setTimeout(() => ctrl.abort(), this.cfg.timeoutMs ?? 30_000);
    signal?.addEventListener("abort", () => ctrl.abort());
    try {
      const res = await fetch(`${this.cfg.baseUrl ?? "https://api.anthropic.com"}/v1/messages`, {
        method: "POST", signal: ctrl.signal,
        headers: { "content-type": "application/json", "x-api-key": this.cfg.apiKey, "anthropic-version": "2023-06-01" },
        body: JSON.stringify({ model: this.cfg.model, max_tokens: req.maxTokens ?? 700, system: req.system, messages: req.messages }),
      });
      if (!res.ok) throw new Error(`LLM HTTP ${res.status}`); // never include the body/headers in errors or logs
      const body = (await res.json()) as { content?: { type: string; text?: string }[] };
      const text = body.content?.filter((c) => c.type === "text").map((c) => c.text ?? "").join("") ?? "";
      if (!text) throw new Error("LLM returned no text");
      return text;
    } finally { clearTimeout(timer); }
  }
}
