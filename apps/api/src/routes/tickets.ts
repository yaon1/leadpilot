import { ApproveTicketSchema, ExtractionSchema, RejectTicketSchema, TicketStatusSchema } from '@leadpilot/shared';
import type { FastifyPluginAsync } from 'fastify';
import { z } from 'zod';
import type { AppDeps } from '../app.js';
import { authorize } from '../auth.js';
import { HttpError } from '../errors.js';
import { publicTicket } from '../tickets.js';

const ListQuery = z.object({
  status: TicketStatusSchema.optional(),
  limit: z.coerce.number().int().min(1).max(100).default(50),
  offset: z.coerce.number().int().min(0).default(0),
});
const IdParams = z.object({ id: z.uuid() });

export const ticketRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    app.get('/tickets', async (req) => {
      const p = authorize(req.principal, 'tickets:read');
      const q = ListQuery.parse(req.query);
      const items = await deps.tickets.list(p.tenantId, q);
      return { items: items.map(publicTicket) };
    });

    app.get('/tickets/:id', async (req) => {
      const p = authorize(req.principal, 'tickets:read');
      const { id } = IdParams.parse(req.params);
      const ticket = await deps.tickets.get(id, p.tenantId);
      if (!ticket) throw new HttpError(404, 'ticket not found', 'not_found');
      return { ...publicTicket(ticket), events: await deps.tickets.events(id) };
    });

    /** Human-in-the-loop: operator confirms (and optionally edits) the reply and fields. */
    app.post('/tickets/:id/approve', async (req) => {
      const p = authorize(req.principal, 'tickets:review');
      const { id } = IdParams.parse(req.params);
      const body = ApproveTicketSchema.parse(req.body ?? {});
      const ticket = await deps.tickets.get(id, p.tenantId);
      if (!ticket) throw new HttpError(404, 'ticket not found', 'not_found');
      if (ticket.status !== 'awaiting_review') throw new HttpError(409, `ticket is ${ticket.status}, expected awaiting_review`, 'invalid_state');

      const extraction = ExtractionSchema.parse({ ...ticket.extraction, ...body.extraction });
      const reply = body.reply ?? ticket.draft?.reply;
      if (!reply) throw new HttpError(400, 'reply is required when there is no draft', 'reply_required');

      const updated = await deps.tickets.transition(id, ['awaiting_review'], 'approved', { extraction, final_reply: reply, reviewed_by: p.keyId }, `key:${p.name}`);
      if (!updated) throw new HttpError(409, 'ticket was changed concurrently', 'conflict');
      if (body.reply && body.reply !== ticket.draft?.reply) await deps.tickets.event(id, 'reply_edited', { draft: ticket.draft?.reply }, `key:${p.name}`);
      await deps.queue.enqueue('sync-crm', id);
      return publicTicket(updated);
    });

    app.post('/tickets/:id/reject', async (req) => {
      const p = authorize(req.principal, 'tickets:review');
      const { id } = IdParams.parse(req.params);
      const { reason } = RejectTicketSchema.parse(req.body);
      const updated = await deps.tickets.transition(id, ['awaiting_review', 'failed'], 'rejected', { error: reason, reviewed_by: p.keyId }, `key:${p.name}`);
      if (!updated) throw new HttpError(409, 'ticket cannot be rejected in its current state', 'invalid_state');
      return publicTicket(updated);
    });

    /** Re-runs a failed ticket from the stage where it stopped. */
    app.post('/tickets/:id/retry', async (req) => {
      const p = authorize(req.principal, 'tickets:review');
      const { id } = IdParams.parse(req.params);
      const ticket = await deps.tickets.get(id, p.tenantId);
      if (!ticket || ticket.status !== 'failed') throw new HttpError(409, 'only failed tickets can be retried', 'invalid_state');
      const toSync = Boolean(ticket.finalReply);
      const updated = await deps.tickets.transition(id, ['failed'], toSync ? 'approved' : 'received', {}, `key:${p.name}`);
      if (!updated) throw new HttpError(409, 'ticket was changed concurrently', 'conflict');
      await deps.queue.enqueue(toSync ? 'sync-crm' : 'process-ticket', id, `retry-${Date.now()}`);
      return publicTicket(updated);
    });

    app.get('/stats', async (req) => {
      const p = authorize(req.principal, 'stats:read');
      return deps.tickets.stats(p.tenantId);
    });
  };
