import Anthropic from '@anthropic-ai/sdk';
import { zodOutputFormat } from '@anthropic-ai/sdk/helpers/zod';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.js';

/**
 * Claude via the official SDK. Uses native structured outputs (JSON schema
 * derived from the same Zod schema we validate with) and server-side refusal
 * fallback, so a classifier decline is retried on another model instead of failing.
 */
export class AnthropicProvider implements LlmProvider {
  readonly name = 'anthropic';
  private readonly client: Anthropic;

  constructor(
    apiKey: string,
    private readonly model = 'claude-opus-5-5',
  ) {
    this.client = new Anthropic({ apiKey, maxRetries: 2, timeout: 60_000 });
  }

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const format = zodOutputFormat(req.schema);
    const res = await this.client.beta.messages.create({
      model: this.model,
      max_tokens: 4096,
      system: req.system,
      messages: req.messages,
      output_config: {
        effort: 'low', // classification / short drafts do not need deep thinking
        format: { type: 'json_schema', schema: format.schema },
      },
      betas: ['server-side-fallback-2026-07-01'],
      fallbacks: 'default',
    });
    if (res.stop_reason === 'refusal') throw new Error('model refused the request');
    const text = res.content.map((b) => (b.type === 'text' ? b.text : '')).join('');
    return { text, inputTokens: res.usage.input_tokens, outputTokens: res.usage.output_tokens };
  }
}
