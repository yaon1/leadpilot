import type { z } from 'zod';

export type LlmTask = 'extract' | 'draft';

export interface ChatMessage {
  role: 'user' | 'assistant';
  content: string;
}

export interface LlmRequest {
  task: LlmTask;
  system: string;
  messages: ChatMessage[];
  /** Target schema; providers with native structured output pass it to the API. */
  schema: z.ZodType;
  schemaName: string;
  /**
   * Structured inputs the prompt was built from. Real providers ignore it (they read
   * the prompt); the deterministic mock provider uses it instead of parsing prose.
   */
  context: LlmContext;
}

export interface LlmContext {
  message: string;
  contactName?: string;
  sources?: { id: number; title: string; content: string; score: number }[];
}

export interface LlmResponse {
  text: string;
  inputTokens?: number;
  outputTokens?: number;
}

export interface LlmProvider {
  readonly name: string;
  complete(req: LlmRequest): Promise<LlmResponse>;
}

export interface EmbeddingProvider {
  readonly name: string;
  readonly dimensions: number;
  embed(texts: string[]): Promise<number[][]>;
}
