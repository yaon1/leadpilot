import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { registry } from '../metrics.js';

export const healthRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get('/healthz', async () => ({ status: 'ok' }));

    app.get('/readyz', async (_req, reply) => {
      const checks: Record<string, string> = {};
      try {
        await deps.db.query('SELECT 1');
        checks.postgres = 'ok';
      } catch (e) {
        checks.postgres = (e as Error).message;
      }
      if (deps.redis) {
        try {
          await deps.redis.ping();
          checks.redis = 'ok';
        } catch (e) {
          checks.redis = (e as Error).message;
        }
      }
      const ok = Object.values(checks).every((v) => v === 'ok');
      return reply.code(ok ? 200 : 503).send({ status: ok ? 'ok' : 'degraded', checks });
    });

    app.get('/metrics', async (_req, reply) => {
      return reply.header('content-type', registry.contentType).send(await registry.metrics());
    });
  };
