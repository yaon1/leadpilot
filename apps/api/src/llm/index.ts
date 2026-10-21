import type { Config } from '../config.js';
import { AnthropicProvider } from './anthropic.js';
import { HashEmbeddingProvider } from './hash-embeddings.js';
import { MockLlmProvider } from './mock.js';
import { OpenAiEmbeddingProvider, OpenAiProvider } from './openai.js';
import type { EmbeddingProvider, LlmProvider } from './types.js';

export * from './types.js';

export function createLlmProvider(cfg: Config): LlmProvider {
  switch (cfg.LLM_PROVIDER) {
    case 'anthropic':
      return new AnthropicProvider(cfg.ANTHROPIC_API_KEY!, cfg.LLM_MODEL);
    case 'openai':
      return new OpenAiProvider(cfg.OPENAI_API_KEY!, cfg.LLM_MODEL, cfg.OPENAI_BASE_URL);
    default:
      return new MockLlmProvider({ invalidFirstAttempt: cfg.MOCK_LLM_INVALID_FIRST_ATTEMPT });
  }
}

export function createEmbeddingProvider(cfg: Config): EmbeddingProvider {
  return cfg.EMBEDDINGS_PROVIDER === 'openai'
    ? new OpenAiEmbeddingProvider(cfg.OPENAI_API_KEY!, cfg.OPENAI_BASE_URL)
    : new HashEmbeddingProvider(256);
}
