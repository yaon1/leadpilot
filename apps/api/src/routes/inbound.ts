import { InboundMessageSchema } from '@leadpilot/shared';
import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { authorize } from '../auth.js';
import { HttpError } from '../errors.js';
import { ingest } from '../ingest.js';

export const inboundRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /**
     * Accepts a message from any channel (web form backend, email parser, n8n/Make
     * scenario, ...). Requires an Idempotency-Key header unless the payload carries
     * a source externalId, so client retries never create duplicate tickets.
     */
    app.post('/inbound', async (req, reply) => {
      const principal = authorize(req.principal, 'ingest');
      const msg = InboundMessageSchema.parse(req.body);
      const header = req.headers['idempotency-key'];
      const key = (Array.isArray(header) ? header[0] : header) ?? (msg.externalId ? `${msg.channel}:${msg.externalId}` : undefined);
      if (!key) throw new HttpError(400, 'Idempotency-Key header (or externalId) is required', 'idempotency_key_required');
      if (key.length > 200) throw new HttpError(400, 'Idempotency-Key is too long', 'idempotency_key_invalid');

      const result = await ingest(deps, principal.tenantId, msg, key);
      if (result.replayed) reply.header('idempotent-replayed', 'true');
      return reply.code(result.statusCode).send(result.body);
    });
  };
