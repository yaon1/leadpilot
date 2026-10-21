import { timingSafeEqual } from 'node:crypto';
import type { FastifyPluginAsync } from 'fastify';
import type { AppDeps } from '../app.js';
import { TelegramUpdateSchema } from '../channels/telegram.js';
import { HttpError } from '../errors.js';
import { ingest } from '../ingest.js';

function safeEqual(a: string, b: string): boolean {
  const ba = Buffer.from(a);
  const bb = Buffer.from(b);
  return ba.length === bb.length && timingSafeEqual(ba, bb);
}

export const telegramRoutes =
  (deps: AppDeps): FastifyPluginAsync =>
  async (app) => {
    /**
     * Telegram Bot API webhook (setWebhook with secret_token). Telegram redelivers
     * on non-2xx, so update_id is used as the idempotency key.
     */
    app.post('/channels/telegram/webhook', async (req, reply) => {
      const secret = deps.cfg.TELEGRAM_WEBHOOK_SECRET;
      if (!secret) throw new HttpError(404, 'telegram channel is not configured', 'not_found');
      const given = req.headers['x-telegram-bot-api-secret-token'];
      if (typeof given !== 'string' || !safeEqual(given, secret)) throw new HttpError(401, 'bad webhook secret', 'unauthorized');

      const update = TelegramUpdateSchema.parse(req.body);
      const m = update.message;
      const text = m?.text ?? m?.caption;
      if (!m || !text || text.startsWith('/start')) return reply.send({ ok: true, ignored: true });

      const tenant = await deps.db.query<{ id: string }>('SELECT id FROM tenants WHERE slug = $1', [deps.cfg.TELEGRAM_TENANT]);
      if (!tenant.rows[0]) throw new HttpError(500, `tenant ${deps.cfg.TELEGRAM_TENANT} not found`);

      const name = [m.from?.first_name, m.from?.last_name].filter(Boolean).join(' ') || m.from?.username;
      const result = await ingest(
        deps,
        tenant.rows[0].id,
        {
          channel: 'telegram',
          externalId: String(update.update_id),
          text,
          contact: { name: name || undefined, phone: m.contact?.phone_number, telegramChatId: String(m.chat.id) },
        },
        `telegram:${update.update_id}`,
      );
      return reply.send({ ok: true, ticketId: result.body.ticketId });
    });
  };
