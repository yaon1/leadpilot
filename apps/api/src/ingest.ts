import type { InboundMessage } from '@leadpilot/shared';
import type { Db } from './db/pool.js';
import type { IdempotencyStore } from './idempotency.js';
import { inboundTotal } from './metrics.js';
import type { Enqueuer } from './queue.js';

export interface IngestDeps {
  db: Db;
  idempotency: IdempotencyStore;
  queue: Enqueuer;
}

export interface IngestResult {
  statusCode: number;
  body: { ticketId: string; status: string; duplicate: boolean };
  replayed: boolean;
}

/**
 * Stores an inbound message as a ticket and queues the AI pipeline. Two layers of
 * deduplication: the idempotency receipt journal (same key -> same response) and a
 * unique (tenant, channel, external_id) constraint (same source message -> same ticket).
 */
export async function ingest(deps: IngestDeps, tenantId: string, msg: InboundMessage, idempotencyKey: string): Promise<IngestResult> {
  const externalId = msg.externalId ?? `idem:${idempotencyKey}`;
  const outcome = await deps.idempotency.run(tenantId, idempotencyKey, msg, async () => {
    const inserted = await deps.db.query<{ id: string; status: string }>(
      `INSERT INTO tickets (tenant_id, channel, external_id, text, contact) VALUES ($1, $2, $3, $4, $5)
       ON CONFLICT (tenant_id, channel, external_id) DO NOTHING RETURNING id, status`,
      [tenantId, msg.channel, externalId, msg.text, JSON.stringify(msg.contact)],
    );
    let row = inserted.rows[0];
    const duplicate = !row;
    if (!row) {
      const existing = await deps.db.query<{ id: string; status: string }>(
        'SELECT id, status FROM tickets WHERE tenant_id = $1 AND channel = $2 AND external_id = $3',
        [tenantId, msg.channel, externalId],
      );
      row = existing.rows[0]!;
    }
    // Enqueue is deduplicated by job id, so re-enqueueing a duplicate that never got queued is safe.
    if (row.status === 'received') await deps.queue.enqueue('process-ticket', row.id);
    return { statusCode: duplicate ? 200 : 202, body: { ticketId: row.id, status: row.status, duplicate } };
  });

  const body = outcome.response.body as IngestResult['body'];
  inboundTotal.inc({ channel: msg.channel, outcome: outcome.replayed ? 'replayed' : body.duplicate ? 'duplicate' : 'accepted' });
  return { statusCode: outcome.response.statusCode, body, replayed: outcome.replayed };
}
