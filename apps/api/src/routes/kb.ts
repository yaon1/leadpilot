import { KbDocumentInputSchema } from '@leadpilot/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { authorize } from '../auth.js';
import { HttpError } from '../errors.js';

const SearchQuery = z.object({ q: z.string().trim().min(1).max(1000), limit: z.coerce.number().int().min(1).max(10).default(5) });

export const kbRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get('/kb/documents', async (req) => {
      const p = authorize(req.principal, 'kb:read');
      return { items: await deps.kb.listDocuments(p.tenantId) };
    });

    app.post('/kb/documents', async (req, reply) => {
      const p = authorize(req.principal, 'kb:write');
      const doc = KbDocumentInputSchema.parse(req.body);
      return reply.code(201).send(await deps.kb.addDocument(p.tenantId, doc.title, doc.content));
    });

    app.delete('/kb/documents/:id', async (req, reply) => {
      const p = authorize(req.principal, 'kb:write');
      const { id } = z.object({ id: z.uuid() }).parse(req.params);
      if (!(await deps.kb.deleteDocument(p.tenantId, id))) throw new HttpError(404, 'document not found', 'not_found');
      return reply.code(204).send();
    });

    app.get('/kb/search', async (req) => {
      const p = authorize(req.principal, 'kb:read');
      const { q, limit } = SearchQuery.parse(req.query);
      return { items: await deps.kb.search(p.tenantId, q, limit, 0) };
    });
  };
