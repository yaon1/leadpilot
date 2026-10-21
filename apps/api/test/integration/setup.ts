import { PostgreSqlContainer, type StartedPostgreSqlContainer } from '@testcontainers/postgresql';
import { RedisContainer, type StartedRedisContainer } from '@testcontainers/redis';
import type { FastifyInstance } from 'fastify';
import { Redis } from 'ioredis';
import { buildApp } from '../../src/app.js';
import { createApiKey } from '../../src/auth.js';
import { loadConfig } from '../../src/config.js';
import { MockCrmAdapter } from '../../src/crm/mock.js';
import { instrument } from '../../src/crm/index.js';
import { createPool, type Db } from '../../src/db/pool.js';
import { migrate } from '../../src/db/migrate.js';
import { IdempotencyStore } from '../../src/idempotency.js';
import { HashEmbeddingProvider } from '../../src/llm/hash-embeddings.js';
import { MockLlmProvider } from '../../src/llm/mock.js';
import { JobQueue, redisConnection } from '../../src/queue.js';
import { KnowledgeBase } from '../../src/rag/kb.js';
import { DEMO_KB } from '../../src/seed-data.js';
import { TicketRepository } from '../../src/tickets.js';
import { startWorker } from '../../src/worker-runtime.js';

export interface TestEnv {
  app: FastifyInstance;
  db: Db;
  tickets: TicketRepository;
  crm: MockCrmAdapter;
  sent: { chatId: string; text: string }[];
  keys: { admin: string; operator: string; agent: string; otherTenant: string };
  tenantId: string;
  stop(): Promise<void>;
}

export async function startEnv(): Promise<TestEnv> {
  const [pg, redisC]: [StartedPostgreSqlContainer, StartedRedisContainer] = await Promise.all([
    new PostgreSqlContainer('pgvector/pgvector:pg17').start(),
    new RedisContainer('redis:7-alpine').start(),
  ]);
  const redisUrl = redisC.getConnectionUrl();
  const cfg = loadConfig({
    DATABASE_URL: pg.getConnectionUri(),
    REDIS_URL: redisUrl,
    LOG_LEVEL: process.env.TEST_LOG_LEVEL ?? 'silent',
    TELEGRAM_WEBHOOK_SECRET: 'tg-secret',
    TELEGRAM_TENANT: 'acme',
    MOCK_LLM_INVALID_FIRST_ATTEMPT: 'true',
  });

  const db = createPool(cfg.DATABASE_URL);
  await migrate(db);
  const tenantId = (await db.query<{ id: string }>("INSERT INTO tenants (slug, name) VALUES ('acme', 'Acme') RETURNING id")).rows[0]!.id;
  const otherId = (await db.query<{ id: string }>("INSERT INTO tenants (slug, name) VALUES ('other', 'Other') RETURNING id")).rows[0]!.id;
  const keys = {
    admin: await createApiKey(db, tenantId, 'admin', 'admin'),
    operator: await createApiKey(db, tenantId, 'operator', 'operator'),
    agent: await createApiKey(db, tenantId, 'agent', 'agent'),
    otherTenant: await createApiKey(db, otherId, 'other-admin', 'admin'),
  };

  const embeddings = new HashEmbeddingProvider(256);
  const kb = new KnowledgeBase(db, embeddings);
  for (const doc of DEMO_KB) await kb.addDocument(tenantId, doc.title, doc.content);

  const tickets = new TicketRepository(db);
  const crm = new MockCrmAdapter(db);
  const connection = redisConnection(redisUrl);
  const queue = new JobQueue(connection);
  const redis = new Redis(redisUrl, { maxRetriesPerRequest: null });
  const sent: { chatId: string; text: string }[] = [];

  const app = await buildApp({ cfg, db, redis, tickets, kb, crm: instrument(crm), idempotency: new IdempotencyStore(db, 24), queue });
  const silent = { info: () => {}, error: () => {} };
  const worker = startWorker(
    {
      tickets,
      llm: new MockLlmProvider({ invalidFirstAttempt: true }),
      kb,
      crm: instrument(crm),
      sender: { sendTelegram: async (chatId, text) => void sent.push({ chatId, text }) },
      settings: { maxAttempts: 3, ragTopK: 3, ragMinScore: 0.1, autoRejectSpamConfidence: 0.8 },
    },
    connection,
    2,
    silent,
  );

  return {
    app,
    db,
    tickets,
    crm,
    sent,
    keys,
    tenantId,
    async stop() {
      await worker.close();
      await app.close();
      await queue.close();
      redis.disconnect();
      await db.end();
      await Promise.all([pg.stop(), redisC.stop()]);
    },
  };
}

export async function waitFor<T>(fn: () => Promise<T | null | undefined | false>, timeoutMs = 15_000): Promise<T> {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    const v = await fn();
    if (v) return v;
    if (Date.now() > deadline) throw new Error('waitFor: timed out');
    await new Promise((r) => setTimeout(r, 100));
  }
}
