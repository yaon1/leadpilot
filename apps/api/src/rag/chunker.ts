/**
 * Splits a document into chunks of up to ~`maxChars` on sentence boundaries,
 * carrying the last sentence of a chunk into the next one (overlap), so facts
 * that straddle a boundary stay retrievable.
 */
export function chunkText(text: string, maxChars = 700): string[] {
  const sentences = text
    .replace(/\r\n/g, '\n')
    .split(/\n\s*\n/)
    .flatMap((p) => p.replace(/\s+/g, ' ').trim().split(/(?<=[.!?…])\s+/))
    .flatMap((s) => (s.length > maxChars ? (s.match(new RegExp(`.{1,${maxChars}}`, 'g')) ?? []) : [s]))
    .map((s) => s.trim())
    .filter(Boolean);

  const chunks: string[] = [];
  let current: string[] = [];
  let fresh = 0; // sentences in `current` that are not overlap

  const length = (parts: string[]) => parts.reduce((n, s) => n + s.length + 1, 0);

  for (const sentence of sentences) {
    if (fresh > 0 && length(current) + sentence.length > maxChars) {
      chunks.push(current.join(' '));
      const last = current[current.length - 1]!;
      current = last.length + sentence.length + 1 <= maxChars ? [last] : [];
      fresh = 0;
    }
    current.push(sentence);
    fresh++;
  }
  if (fresh > 0) chunks.push(current.join(' '));
  return chunks;
}
