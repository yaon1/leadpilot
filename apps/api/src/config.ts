import { z } from 'zod';

const bool = z
  .enum(['true', 'false', '1', '0'])
  .default('false')
  .transform((v) => v === 'true' || v === '1');

export const ConfigSchema = z.object({
  NODE_ENV: z.enum(['development', 'test', 'production']).default('development'),
  PORT: z.coerce.number().int().default(3000),
  HOST: z.string().default('0.0.0.0'),
  LOG_LEVEL: z.enum(['fatal', 'error', 'warn', 'info', 'debug', 'trace', 'silent']).default('info'),
  DATABASE_URL: z.string().default('postgres://leadpilot:leadpilot@localhost:5432/leadpilot'),
  REDIS_URL: z.string().default('redis://localhost:6379'),
  CORS_ORIGIN: z.string().default('http://localhost:5173'),
  RATE_LIMIT_PER_MINUTE: z.coerce.number().int().positive().default(120),

  // LLM
  LLM_PROVIDER: z.enum(['mock', 'anthropic', 'openai']).default('mock'),
  LLM_MODEL: z.string().optional(),
  LLM_MAX_ATTEMPTS: z.coerce.number().int().min(1).max(5).default(3),
  ANTHROPIC_API_KEY: z.string().optional(),
  OPENAI_API_KEY: z.string().optional(),
  OPENAI_BASE_URL: z.string().url().optional(),
  EMBEDDINGS_PROVIDER: z.enum(['hash', 'openai']).default('hash'),
  /** Mock provider: return an invalid answer on the first attempt to exercise retry-with-error. */
  MOCK_LLM_INVALID_FIRST_ATTEMPT: bool,

  // RAG
  RAG_TOP_K: z.coerce.number().int().min(1).max(10).default(4),
  RAG_MIN_SCORE: z.coerce.number().min(0).max(1).default(0.15),
  AUTO_REJECT_SPAM_CONFIDENCE: z.coerce.number().min(0).max(1).default(0.8),

  // CRM
  CRM_PROVIDER: z.enum(['mock', 'bitrix24', 'amocrm']).default('mock'),
  BITRIX24_WEBHOOK_URL: z.string().url().optional(),
  BITRIX24_RESPONSIBLE_ID: z.coerce.number().int().default(1),
  AMOCRM_BASE_URL: z.string().url().optional(),
  AMOCRM_ACCESS_TOKEN: z.string().optional(),

  // Telegram
  TELEGRAM_BOT_TOKEN: z.string().optional(),
  TELEGRAM_WEBHOOK_SECRET: z.string().optional(),
  TELEGRAM_TENANT: z.string().default('demo'),

  // Idempotency
  IDEMPOTENCY_TTL_HOURS: z.coerce.number().int().positive().default(24),

  // Worker
  WORKER_CONCURRENCY: z.coerce.number().int().positive().default(4),
  WORKER_METRICS_PORT: z.coerce.number().int().default(9465),

  // Seed (dev only)
  DEMO_ADMIN_KEY: z.string().optional(),
  DEMO_OPERATOR_KEY: z.string().optional(),
  DEMO_AGENT_KEY: z.string().optional(),
});

export type Config = z.infer<typeof ConfigSchema>;

export function loadConfig(env: NodeJS.ProcessEnv = process.env): Config {
  // Treat empty variables (common with docker compose `${VAR:-}`) as unset.
  const cleaned = Object.fromEntries(Object.entries(env).filter(([, v]) => v !== undefined && v !== ''));
  const parsed = ConfigSchema.safeParse(cleaned);
  if (!parsed.success) {
    const issues = parsed.error.issues.map((i) => `${i.path.join('.')}: ${i.message}`).join('; ');
    throw new Error(`Invalid configuration: ${issues}`);
  }
  const cfg = parsed.data;
  if (cfg.LLM_PROVIDER === 'anthropic' && !cfg.ANTHROPIC_API_KEY) throw new Error('ANTHROPIC_API_KEY is required for LLM_PROVIDER=anthropic');
  if (cfg.LLM_PROVIDER === 'openai' && !cfg.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for LLM_PROVIDER=openai');
  if (cfg.EMBEDDINGS_PROVIDER === 'openai' && !cfg.OPENAI_API_KEY) throw new Error('OPENAI_API_KEY is required for EMBEDDINGS_PROVIDER=openai');
  if (cfg.CRM_PROVIDER === 'bitrix24' && !cfg.BITRIX24_WEBHOOK_URL) throw new Error('BITRIX24_WEBHOOK_URL is required for CRM_PROVIDER=bitrix24');
  if (cfg.CRM_PROVIDER === 'amocrm' && (!cfg.AMOCRM_BASE_URL || !cfg.AMOCRM_ACCESS_TOKEN))
    throw new Error('AMOCRM_BASE_URL and AMOCRM_ACCESS_TOKEN are required for CRM_PROVIDER=amocrm');
  return cfg;
}
