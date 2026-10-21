import type { EmbeddingProvider } from './types.js';

/** Crude stemmer: lowercases, strips punctuation and keeps the first 6 letters of a word. */
export function tokenize(text: string): string[] {
  return (text.toLowerCase().replace(/ё/g, 'е').match(/[\p{L}\p{N}]+/gu) ?? [])
    .filter((t) => t.length > 2)
    .map((t) => t.slice(0, 6));
}

function fnv1a(s: string): number {
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

/**
 * Feature-hashing embeddings (bag of stems + bigrams). No network, deterministic,
 * good enough for keyword-level retrieval in demos and tests. Swap for
 * EMBEDDINGS_PROVIDER=openai in production.
 */
export class HashEmbeddingProvider implements EmbeddingProvider {
  readonly name = 'hash';

  constructor(readonly dimensions = 256) {}

  async embed(texts: string[]): Promise<number[][]> {
    return texts.map((t) => this.embedOne(t));
  }

  embedOne(text: string): number[] {
    const v = new Array<number>(this.dimensions).fill(0);
    const tokens = tokenize(text);
    const features = [...tokens, ...tokens.slice(1).map((t, i) => `${tokens[i]}_${t}`)];
    for (const f of features) {
      const h = fnv1a(f);
      const idx = h % this.dimensions;
      v[idx] = (v[idx] ?? 0) + ((h >>> 31) & 1 ? 1 : -1) * (f.includes('_') ? 0.5 : 1);
    }
    const norm = Math.hypot(...v) || 1;
    return v.map((x) => x / norm);
  }
}
