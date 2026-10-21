import { CrmTaskInputSchema } from '@leadpilot/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { authorize } from '../auth.js';

const DealsQuery = z.object({ q: z.string().trim().max(200).default(''), limit: z.coerce.number().int().min(1).max(50).default(20) });

export const crmRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get('/crm/deals', async (req) => {
      const p = authorize(req.principal, 'crm:read');
      const { q, limit } = DealsQuery.parse(req.query);
      return { adapter: deps.crm.name, items: await deps.crm.searchDeals(p.tenantId, q, limit) };
    });

    app.post('/crm/tasks', async (req, reply) => {
      const p = authorize(req.principal, 'crm:write');
      const task = CrmTaskInputSchema.parse(req.body);
      return reply.code(201).send(await deps.crm.createTask(p.tenantId, task));
    });
  };
