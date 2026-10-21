import type { z } from 'zod';
import { llmAttempts, llmDuration, llmRequestsTotal } from '../metrics.js';
import { withSpan } from '../telemetry.js';
import type { ChatMessage, LlmContext, LlmProvider, LlmTask } from './types.js';

export class LlmValidationError extends Error {
  constructor(
    public readonly errors: string[],
    public readonly attempts: number,
    public readonly lastOutput: string,
  ) {
    super(`LLM output failed validation after ${attempts} attempt(s): ${errors.join('; ')}`);
  }
}

export interface StructuredOptions<T> {
  task: LlmTask;
  system: string;
  prompt: string;
  schema: z.ZodType<T>;
  schemaName: string;
  context: LlmContext;
  maxAttempts?: number;
  /** Business rules on top of the schema (e.g. "cited source must exist"). Return error messages. */
  validate?: (value: T) => string[];
}

export interface StructuredResult<T> {
  value: T;
  attempts: number;
}

/** Extracts a JSON value from model output, tolerating ```json fences and surrounding prose. */
export function parseJsonLoose(text: string): unknown {
  const trimmed = text.trim();
  const fenced = /```(?:json)?\s*([\s\S]*?)```/i.exec(trimmed);
  const candidate = fenced?.[1] ?? trimmed;
  try {
    return JSON.parse(candidate);
  } catch {
    const start = candidate.indexOf('{');
    const end = candidate.lastIndexOf('}');
    if (start >= 0 && end > start) return JSON.parse(candidate.slice(start, end + 1));
    throw new Error('no JSON object found');
  }
}

export function formatIssues(error: z.ZodError): string[] {
  return error.issues.map((i) => `${i.path.length ? i.path.join('.') : '(root)'}: ${i.message}`);
}

/**
 * Calls the model and validates its answer against a Zod schema. On failure the
 * invalid answer and the exact validation errors are fed back to the model
 * ("retry-with-error"), up to `maxAttempts` times.
 */
export async function generateStructured<T>(provider: LlmProvider, opts: StructuredOptions<T>): Promise<StructuredResult<T>> {
  const maxAttempts = opts.maxAttempts ?? 3;
  const messages: ChatMessage[] = [{ role: 'user', content: opts.prompt }];
  let errors: string[] = [];
  let lastOutput = '';

  for (let attempt = 1; attempt <= maxAttempts; attempt++) {
    const stop = llmDuration.startTimer({ provider: provider.name, task: opts.task });
    let text: string;
    try {
      const res = await withSpan(
        `llm.${opts.task}`,
        { 'llm.provider': provider.name, 'llm.attempt': attempt, 'llm.schema': opts.schemaName },
        () => provider.complete({ task: opts.task, system: opts.system, messages, schema: opts.schema, schemaName: opts.schemaName, context: opts.context }),
      );
      text = res.text;
    } catch (err) {
      llmRequestsTotal.inc({ provider: provider.name, task: opts.task, outcome: 'error' });
      throw err; // transport errors are retried by the job queue with backoff
    } finally {
      stop();
    }
    lastOutput = text;

    let candidate: unknown;
    try {
      candidate = parseJsonLoose(text);
      const parsed = opts.schema.safeParse(candidate);
      errors = parsed.success ? (opts.validate?.(parsed.data) ?? []) : formatIssues(parsed.error);
      if (parsed.success && errors.length === 0) {
        llmRequestsTotal.inc({ provider: provider.name, task: opts.task, outcome: 'ok' });
        llmAttempts.observe({ task: opts.task }, attempt);
        return { value: parsed.data, attempts: attempt };
      }
    } catch (err) {
      errors = [`response is not valid JSON (${(err as Error).message})`];
    }

    llmRequestsTotal.inc({ provider: provider.name, task: opts.task, outcome: 'invalid' });
    messages.push(
      { role: 'assistant', content: text },
      {
        role: 'user',
        content: `Your previous answer failed validation:\n${errors.map((e) => `- ${e}`).join('\n')}\nReturn the corrected JSON object only, matching the ${opts.schemaName} schema.`,
      },
    );
  }

  llmAttempts.observe({ task: opts.task }, maxAttempts);
  throw new LlmValidationError(errors, maxAttempts, lastOutput);
}
