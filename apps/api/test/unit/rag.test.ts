import { describe, expect, it } from 'vitest';
import { HashEmbeddingProvider, tokenize } from '../../src/llm/hash-embeddings.js';
import { chunkText } from '../../src/rag/chunker.js';

const cosine = (a: number[], b: number[]) => a.reduce((s, x, i) => s + x * b[i]!, 0);

describe('chunkText', () => {
  it('keeps short documents in one chunk', () => {
    expect(chunkText('Первое. Второе.')).toEqual(['Первое. Второе.']);
  });

  it('splits long text on sentence boundaries with one-sentence overlap', () => {
    const sentences = Array.from({ length: 30 }, (_, i) => `Предложение номер ${i} про интеграцию с CRM.`);
    const chunks = chunkText(sentences.join(' '), 200);
    expect(chunks.length).toBeGreaterThan(3);
    for (const c of chunks) expect(c.length).toBeLessThanOrEqual(200);
    for (let i = 1; i < chunks.length; i++) {
      const prevLast = chunks[i - 1]!.split(/(?<=\.)\s+/).pop()!;
      expect(chunks[i]!.startsWith(prevLast)).toBe(true);
    }
    // every sentence is present somewhere
    for (const s of sentences) expect(chunks.some((c) => c.includes(s))).toBe(true);
  });

  it('hard-splits a single sentence that is longer than the limit', () => {
    const chunks = chunkText('a'.repeat(450), 200);
    expect(chunks.every((c) => c.length <= 200)).toBe(true);
    expect(chunks.join('').length).toBe(450);
  });
});

describe('HashEmbeddingProvider', () => {
  const e = new HashEmbeddingProvider(256);

  it('stems Russian words so word forms match', () => {
    expect(tokenize('Интеграция интеграции интеграцию')).toEqual(['интегр', 'интегр', 'интегр']);
  });

  it('produces unit vectors of the configured size', async () => {
    const [v] = await e.embed(['Сколько стоит интеграция с Битрикс24?']);
    expect(v).toHaveLength(256);
    expect(Math.hypot(...v!)).toBeCloseTo(1, 5);
  });

  it('ranks the relevant document higher', async () => {
    const [q, bitrix, refund] = await e.embed([
      'сколько стоит интеграция с битрикс24',
      'Интеграция сайта с Битрикс24 стоит от 35 000 рублей',
      'Гарантия и возврат предоплаты в течение 10 дней',
    ]);
    expect(cosine(q!, bitrix!)).toBeGreaterThan(cosine(q!, refund!));
  });
});
