import cors from '@fastify/cors';
import rateLimit from '@fastify/rate-limit';
import Fastify, { type FastifyInstance } from 'fastify';
import type { Redis } from 'ioredis';
import { ZodError } from 'zod';
import { authenticate, hashKey } from './auth.js';
import type { Config } from './config.js';
import type { CrmAdapter } from './crm/types.js';
import type { Db } from './db/pool.js';
import { HttpError } from './errors.js';
import type { IdempotencyStore } from './idempotency.js';
import type { Enqueuer } from './queue.js';
import type { KnowledgeBase } from './rag/kb.js';
import { crmRoutes } from './routes/crm.js';
import { healthRoutes } from './routes/health.js';
import { inboundRoutes } from './routes/inbound.js';
import { kbRoutes } from './routes/kb.js';
import { telegramRoutes } from './routes/telegram.js';
import { ticketRoutes } from './routes/tickets.js';
import type { TicketRepository } from './tickets.js';

export interface AppDeps {
  cfg: Config;
  db: Db;
  redis?: Redis;
  tickets: TicketRepository;
  kb: KnowledgeBase;
  crm: CrmAdapter;
  idempotency: IdempotencyStore;
  queue: Enqueuer;
}

export async function buildApp(deps: AppDeps): Promise<FastifyInstance> {
  const app = Fastify({
    logger: {
      level: deps.cfg.LOG_LEVEL,
      redact: ['req.headers.authorization', 'req.headers["x-telegram-bot-api-secret-token"]'],
    },
    bodyLimit: 1024 * 1024,
    trustProxy: true,
  });

  app.setErrorHandler((err, req, reply) => {
    if (err instanceof HttpError) {
      return reply.code(err.statusCode).headers(err.headers).send({ error: err.code, message: err.message });
    }
    if (err instanceof ZodError) {
      return reply.code(400).send({ error: 'validation_error', issues: err.issues.map((i) => ({ path: i.path.join('.'), message: i.message })) });
    }
    const e = err as { statusCode?: number; message: string; code?: string };
    if (e.statusCode && e.statusCode < 500) {
      return reply.code(e.statusCode).send({ error: e.code ?? 'error', message: e.message });
    }
    req.log.error({ err }, 'unhandled error');
    return reply.code(500).send({ error: 'internal_error', message: 'Internal server error' });
  });

  await app.register(cors, { origin: deps.cfg.CORS_ORIGIN.split(',').map((s) => s.trim()) });
  await app.register(rateLimit, {
    max: deps.cfg.RATE_LIMIT_PER_MINUTE,
    timeWindow: '1 minute',
    redis: deps.redis,
    keyGenerator: (req) => {
      const auth = req.headers.authorization;
      return auth ? `key:${hashKey(auth).slice(0, 16)}` : `ip:${req.ip}`;
    },
    allowList: (req) => req.url === '/healthz' || req.url === '/readyz' || req.url === '/metrics',
  });

  // Every /v1 route except the Telegram webhook (which has its own secret) needs an API key.
  app.addHook('onRequest', async (req) => {
    if (!req.url.startsWith('/v1/') || req.url.startsWith('/v1/channels/telegram/')) return;
    req.principal = await authenticate(deps.db, req);
  });

  await app.register(healthRoutes(deps));
  await app.register(inboundRoutes(deps), { prefix: '/v1' });
  await app.register(telegramRoutes(deps), { prefix: '/v1' });
  await app.register(ticketRoutes(deps), { prefix: '/v1' });
  await app.register(kbRoutes(deps), { prefix: '/v1' });
  await app.register(crmRoutes(deps), { prefix: '/v1' });

  app.get('/v1/me', async (req) => {
    const p = req.principal!;
    return { tenant: p.tenantSlug, role: p.role, name: p.name };
  });

  return app;
}
