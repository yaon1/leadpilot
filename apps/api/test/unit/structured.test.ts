import { ExtractionSchema } from '@leadpilot/shared';
import { describe, expect, it } from 'vitest';
import { z } from 'zod';
import { LlmValidationError, generateStructured, parseJsonLoose } from '../../src/llm/structured.js';
import type { LlmProvider, LlmRequest } from '../../src/llm/types.js';

class ScriptedProvider implements LlmProvider {
  readonly name = 'scripted';
  readonly requests: LlmRequest[] = [];
  constructor(private readonly answers: string[]) {}
  async complete(req: LlmRequest) {
    this.requests.push(structuredClone({ ...req, schema: undefined }) as unknown as LlmRequest);
    const text = this.answers.shift();
    if (text === undefined) throw new Error('no more answers');
    return { text };
  }
}

const Schema = z.object({ intent: z.enum(['a', 'b']), phone: z.string().regex(/^\+\d+$/, 'phone must be E.164') });
const base = { task: 'extract' as const, system: 's', prompt: 'p', schema: Schema, schemaName: 'Test', context: { message: 'm' } };

describe('parseJsonLoose', () => {
  it('parses fenced and prose-wrapped JSON', () => {
    expect(parseJsonLoose('```json\n{"a":1}\n```')).toEqual({ a: 1 });
    expect(parseJsonLoose('Here you go: {"a":{"b":2}} hope it helps')).toEqual({ a: { b: 2 } });
  });
  it('throws on text without JSON', () => {
    expect(() => parseJsonLoose('no json here')).toThrow();
  });
});

describe('generateStructured', () => {
  it('returns on the first valid answer', async () => {
    const p = new ScriptedProvider(['{"intent":"a","phone":"+7999"}']);
    const r = await generateStructured(p, base);
    expect(r).toEqual({ value: { intent: 'a', phone: '+7999' }, attempts: 1 });
  });

  it('feeds validation errors back to the model and retries', async () => {
    const p = new ScriptedProvider(['{"intent":"a","phone":"8 999"}', '{"intent":"a","phone":"+7999"}']);
    const r = await generateStructured(p, base);
    expect(r.attempts).toBe(2);
    const retry = p.requests[1]!;
    expect(retry.messages).toHaveLength(3);
    expect(retry.messages[1]).toEqual({ role: 'assistant', content: '{"intent":"a","phone":"8 999"}' });
    expect(retry.messages[2]!.content).toContain('phone: phone must be E.164');
  });

  it('treats non-JSON as a validation failure', async () => {
    const p = new ScriptedProvider(['I cannot answer', '{"intent":"b","phone":"+1"}']);
    const r = await generateStructured(p, base);
    expect(r.attempts).toBe(2);
    expect(p.requests[1]!.messages[2]!.content).toContain('not valid JSON');
  });

  it('applies business-rule validators on top of the schema', async () => {
    const p = new ScriptedProvider(['{"intent":"a","phone":"+1"}', '{"intent":"b","phone":"+1"}']);
    const r = await generateStructured(p, { ...base, validate: (v) => (v.intent === 'a' ? ['intent a is not allowed here'] : []) });
    expect(r.value.intent).toBe('b');
  });

  it('gives up after maxAttempts with the collected errors', async () => {
    const p = new ScriptedProvider(['{}', '{}']);
    const err = await generateStructured(p, { ...base, maxAttempts: 2 }).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(LlmValidationError);
    expect((err as LlmValidationError).attempts).toBe(2);
    expect((err as LlmValidationError).errors.join()).toContain('intent');
  });

  it('propagates transport errors without retrying (the job queue retries those)', async () => {
    const p = new ScriptedProvider([]);
    await expect(generateStructured(p, base)).rejects.toThrow('no more answers');
    expect(p.requests).toHaveLength(1);
  });

  it('works with the real Extraction schema', async () => {
    const valid = { intent: 'support', confidence: 0.8, summary: 'x', customerName: null, phone: null, email: null, product: null, budgetRub: null, urgency: 'high' };
    const p = new ScriptedProvider([JSON.stringify(valid)]);
    const r = await generateStructured(p, { ...base, schema: ExtractionSchema });
    expect(r.value.intent).toBe('support');
  });
});
