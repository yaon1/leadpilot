/**
 * Prompt/model eval on a fixed labelled dataset.
 *
 *   pnpm eval                          # deterministic mock provider (CI)
 *   LLM_PROVIDER=anthropic ANTHROPIC_API_KEY=... pnpm eval
 *
 * Reports intent accuracy, per-field accuracy, a confusion matrix and the number
 * of attempts needed to get a schema-valid answer. Exits 1 if intent accuracy is
 * below EVAL_MIN_INTENT_ACCURACY, so a prompt change that regresses fails CI.
 */
import { readFile, mkdir, writeFile } from 'node:fs/promises';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ExtractionSchema, IntentSchema, type Extraction } from '@leadpilot/shared';
import { loadConfig } from '../src/config.js';
import { createLlmProvider } from '../src/llm/index.js';
import { EXTRACT_SYSTEM, extractPrompt } from '../src/llm/prompts.js';
import { generateStructured } from '../src/llm/structured.js';

interface Case {
  id: string;
  text: string;
  expected: Partial<Extraction>;
}

const here = dirname(fileURLToPath(import.meta.url));
const cases = JSON.parse(await readFile(join(here, 'dataset.json'), 'utf8')) as Case[];
const cfg = loadConfig();
const llm = createLlmProvider(cfg);
const minAccuracy = Number(process.env.EVAL_MIN_INTENT_ACCURACY ?? 0.8);
const concurrency = Number(process.env.EVAL_CONCURRENCY ?? 4);

type Row = { id: string; ok: boolean; expected: Partial<Extraction>; actual: Extraction | null; attempts: number; ms: number; error?: string; fieldMisses: string[] };
const rows: Row[] = [];

async function runCase(c: Case): Promise<Row> {
  const t0 = performance.now();
  try {
    const r = await generateStructured(llm, {
      task: 'extract',
      system: EXTRACT_SYSTEM,
      prompt: extractPrompt(c.text, ''),
      schema: ExtractionSchema,
      schemaName: 'Extraction',
      context: { message: c.text },
      maxAttempts: cfg.LLM_MAX_ATTEMPTS,
    });
    const fieldMisses = Object.entries(c.expected)
      .filter(([k, v]) => k !== 'intent' && r.value[k as keyof Extraction] !== v)
      .map(([k]) => k);
    return { id: c.id, ok: r.value.intent === c.expected.intent, expected: c.expected, actual: r.value, attempts: r.attempts, ms: performance.now() - t0, fieldMisses };
  } catch (err) {
    return { id: c.id, ok: false, expected: c.expected, actual: null, attempts: cfg.LLM_MAX_ATTEMPTS, ms: performance.now() - t0, error: (err as Error).message, fieldMisses: [] };
  }
}

for (let i = 0; i < cases.length; i += concurrency) {
  rows.push(...(await Promise.all(cases.slice(i, i + concurrency).map(runCase))));
}

// --- report --------------------------------------------------------------
const intents = IntentSchema.options;
const accuracy = rows.filter((r) => r.ok).length / rows.length;
const fieldStats = new Map<string, { total: number; correct: number }>();
for (const r of rows) {
  for (const k of Object.keys(r.expected).filter((k) => k !== 'intent')) {
    const s = fieldStats.get(k) ?? { total: 0, correct: 0 };
    s.total++;
    if (r.actual && !r.fieldMisses.includes(k)) s.correct++;
    fieldStats.set(k, s);
  }
}
const matrix = Object.fromEntries(intents.map((e) => [e, Object.fromEntries(intents.map((a) => [a, 0]))])) as Record<string, Record<string, number>>;
for (const r of rows) if (r.actual && r.expected.intent) matrix[r.expected.intent]![r.actual.intent]!++;

const pct = (x: number) => `${(x * 100).toFixed(1)}%`;
console.log(`\nProvider: ${llm.name}${cfg.LLM_MODEL ? ` (${cfg.LLM_MODEL})` : ''} · cases: ${rows.length}\n`);
console.log(`Intent accuracy: ${pct(accuracy)}  (threshold ${pct(minAccuracy)})`);
for (const [k, s] of fieldStats) console.log(`  ${k.padEnd(13)} ${pct(s.correct / s.total).padStart(6)}  (${s.correct}/${s.total})`);
console.log(`Avg attempts: ${(rows.reduce((n, r) => n + r.attempts, 0) / rows.length).toFixed(2)} · avg latency: ${(rows.reduce((n, r) => n + r.ms, 0) / rows.length).toFixed(0)} ms`);
console.log('\nConfusion matrix (rows = expected, cols = predicted):');
console.table(matrix);
const failures = rows.filter((r) => !r.ok || r.fieldMisses.length);
if (failures.length) {
  console.log('Misses:');
  for (const f of failures) {
    console.log(`  ${f.id}: expected ${f.expected.intent}, got ${f.actual?.intent ?? 'ERROR'}${f.fieldMisses.length ? `; fields: ${f.fieldMisses.join(', ')}` : ''}${f.error ? ` (${f.error})` : ''}`);
  }
}

await mkdir(join(here, 'results'), { recursive: true });
await writeFile(join(here, 'results', `${llm.name}.json`), JSON.stringify({ provider: llm.name, model: cfg.LLM_MODEL, accuracy, fields: Object.fromEntries(fieldStats), matrix, rows }, null, 2));

if (accuracy < minAccuracy) {
  console.error(`\nFAIL: intent accuracy ${pct(accuracy)} is below ${pct(minAccuracy)}`);
  process.exit(1);
}
