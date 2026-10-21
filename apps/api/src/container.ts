import { Redis } from 'ioredis';
import type { Config } from './config.js';
import { createCrmAdapter } from './crm/index.js';
import { createPool } from './db/pool.js';
import { IdempotencyStore } from './idempotency.js';
import { createEmbeddingProvider, createLlmProvider } from './llm/index.js';
import { JobQueue, redisConnection } from './queue.js';
import { KnowledgeBase } from './rag/kb.js';
import { TicketRepository } from './tickets.js';

/** Wires production dependencies from config. Tests build their own graph. */
export function createContainer(cfg: Config) {
  const db = createPool(cfg.DATABASE_URL);
  const redis = new Redis(cfg.REDIS_URL, { maxRetriesPerRequest: null, lazyConnect: false });
  const embeddings = createEmbeddingProvider(cfg);
  return {
    cfg,
    db,
    redis,
    connection: redisConnection(cfg.REDIS_URL),
    llm: createLlmProvider(cfg),
    embeddings,
    kb: new KnowledgeBase(db, embeddings),
    tickets: new TicketRepository(db),
    crm: createCrmAdapter(cfg, db),
    idempotency: new IdempotencyStore(db, cfg.IDEMPOTENCY_TTL_HOURS),
    queue: new JobQueue(redisConnection(cfg.REDIS_URL)),
  };
}
export type Container = ReturnType<typeof createContainer>;
