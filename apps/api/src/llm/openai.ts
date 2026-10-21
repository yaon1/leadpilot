import OpenAI from 'openai';
import type { EmbeddingProvider, LlmProvider, LlmRequest, LlmResponse } from './types.js';

/** OpenAI (or any OpenAI-compatible endpoint, e.g. a local vLLM/Ollama) in JSON mode. */
export class OpenAiProvider implements LlmProvider {
  readonly name = 'openai';
  private readonly client: OpenAI;

  constructor(
    apiKey: string,
    private readonly model = 'gpt-4.1-mini',
    baseURL?: string,
  ) {
    this.client = new OpenAI({ apiKey, baseURL, maxRetries: 2, timeout: 60_000 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const res = await this.client.chat.completions.create({
      model: this.model,
      response_format: { type: 'json_object' },
      messages: [{ role: 'system', content: req.system }, ...req.messages],
    });
    return {
      text: res.choices[0]?.message.content ?? '',
      inputTokens: res.usage?.prompt_tokens,
      outputTokens: res.usage?.completion_tokens,
    };
  }
}

export class OpenAiEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'openai';
  readonly dimensions = 256;
  private readonly client: OpenAI;

  constructor(apiKey: string, baseURL?: string) {
    this.client = new OpenAI({ apiKey, baseURL });
  }

  async embed(texts: string[]): Promise<number[][]> {
    const res = await this.client.embeddings.create({ model: 'text-embedding-3-small', input: texts, dimensions: this.dimensions });
    return res.data.map((d) => d.embedding);
  }
}
