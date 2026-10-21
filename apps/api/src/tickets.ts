import type { Contact, DraftReply, Extraction, KbSource, Ticket, TicketStatus } from '@leadpilot/shared';
import type { Db, Queryable } from './db/pool.js';
import { ticketTransitions } from './metrics.js';

interface TicketRow {
  id: string;
  tenant_id: string;
  channel: Ticket['channel'];
  external_id: string | null;
  text: string;
  contact: Contact;
  status: TicketStatus;
  extraction: Extraction | null;
  draft: DraftReply | null;
  sources: KbSource[];
  final_reply: string | null;
  crm_deal_id: string | null;
  reply_sent_at: Date | null;
  error: string | null;
  llm_attempts: number;
  created_at: Date;
  updated_at: Date;
}

export type TicketRecord = Ticket & { tenantId: string; replySentAt: string | null };

function toTicket(r: TicketRow): TicketRecord {
  return {
    id: r.id,
    tenantId: r.tenant_id,
    channel: r.channel,
    externalId: r.external_id,
    text: r.text,
    contact: r.contact,
    status: r.status,
    extraction: r.extraction,
    draft: r.draft,
    sources: r.sources,
    finalReply: r.final_reply,
    crmDealId: r.crm_deal_id,
    replySentAt: r.reply_sent_at?.toISOString() ?? null,
    error: r.error,
    llmAttempts: r.llm_attempts,
    createdAt: r.created_at.toISOString(),
    updatedAt: r.updated_at.toISOString(),
  };
}

export class TicketRepository {
  constructor(private readonly db: Db) {}

  async get(id: string, tenantId?: string, q: Queryable = this.db): Promise<TicketRecord | null> {
    const res = await q.query<TicketRow>(
      tenantId ? 'SELECT * FROM tickets WHERE id = $1 AND tenant_id = $2' : 'SELECT * FROM tickets WHERE id = $1',
      tenantId ? [id, tenantId] : [id],
    );
    return res.rows[0] ? toTicket(res.rows[0]) : null;
  }

  async list(tenantId: string, opts: { status?: TicketStatus; limit: number; offset: number }): Promise<TicketRecord[]> {
    const res = await this.db.query<TicketRow>(
      `SELECT * FROM tickets WHERE tenant_id = $1 AND ($2::text IS NULL OR status = $2)
        ORDER BY created_at DESC LIMIT $3 OFFSET $4`,
      [tenantId, opts.status ?? null, opts.limit, opts.offset],
    );
    return res.rows.map(toTicket);
  }

  /**
   * Atomically moves a ticket from one of `from` statuses to `to` (optimistic
   * state machine). Returns null if the ticket was not in an allowed state.
   */
  async transition(
    id: string,
    from: TicketStatus[],
    to: TicketStatus,
    patch: Partial<{
      extraction: Extraction;
      draft: DraftReply | null;
      sources: KbSource[];
      final_reply: string;
      crm_deal_id: string;
      error: string | null;
      llm_attempts: number;
      reviewed_by: string;
    }> = {},
    actor = 'system',
    q: Queryable = this.db,
  ): Promise<TicketRecord | null> {
    const keys = Object.keys(patch) as (keyof typeof patch)[];
    const sets = keys.map((k, i) => `${k} = $${i + 4}${['extraction', 'draft', 'sources'].includes(k) ? '::jsonb' : ''}`);
    const values = keys.map((k) => {
      const v = patch[k];
      return ['extraction', 'draft', 'sources'].includes(k) ? JSON.stringify(v) : v;
    });
    const res = await q.query<TicketRow>(
      `UPDATE tickets SET status = $3, updated_at = now()${sets.length ? `, ${sets.join(', ')}` : ''}
        WHERE id = $1 AND status = ANY($2::text[]) RETURNING *`,
      [id, from, to, ...values],
    );
    const row = res.rows[0];
    if (!row) return null;
    ticketTransitions.inc({ status: to });
    await this.event(id, `status:${to}`, { from }, actor, q);
    return toTicket(row);
  }

  async markReplySent(id: string): Promise<void> {
    await this.db.query('UPDATE tickets SET reply_sent_at = now(), updated_at = now() WHERE id = $1', [id]);
  }

  async setCrmDeal(id: string, dealId: string): Promise<void> {
    await this.db.query('UPDATE tickets SET crm_deal_id = $2, updated_at = now() WHERE id = $1', [id, dealId]);
  }

  async event(ticketId: string, type: string, data: unknown, actor: string, q: Queryable = this.db): Promise<void> {
    await q.query('INSERT INTO ticket_events (ticket_id, type, data, actor) VALUES ($1, $2, $3, $4)', [ticketId, type, JSON.stringify(data), actor]);
  }

  async events(ticketId: string) {
    const res = await this.db.query<{ id: string; type: string; data: unknown; actor: string; created_at: Date }>(
      'SELECT id, type, data, actor, created_at FROM ticket_events WHERE ticket_id = $1 ORDER BY id',
      [ticketId],
    );
    return res.rows.map((r) => ({ id: Number(r.id), type: r.type, data: r.data, actor: r.actor, createdAt: r.created_at.toISOString() }));
  }

  async stats(tenantId: string) {
    const [byStatus, byIntent, misc] = await Promise.all([
      this.db.query<{ k: string; n: number }>('SELECT status AS k, count(*)::int AS n FROM tickets WHERE tenant_id = $1 GROUP BY status', [tenantId]),
      this.db.query<{ k: string; n: number }>(
        "SELECT extraction->>'intent' AS k, count(*)::int AS n FROM tickets WHERE tenant_id = $1 AND extraction IS NOT NULL GROUP BY 1",
        [tenantId],
      ),
      this.db.query<{ last24h: number; avg: number | null }>(
        `SELECT count(*) FILTER (WHERE created_at > now() - interval '24 hours')::int AS last24h,
                avg(llm_attempts) FILTER (WHERE llm_attempts > 0)::float AS avg
           FROM tickets WHERE tenant_id = $1`,
        [tenantId],
      ),
    ]);
    return {
      byStatus: Object.fromEntries(byStatus.rows.map((r) => [r.k, r.n])),
      byIntent: Object.fromEntries(byIntent.rows.map((r) => [r.k, r.n])),
      last24h: misc.rows[0]?.last24h ?? 0,
      avgLlmAttempts: Number((misc.rows[0]?.avg ?? 0).toFixed(2)),
    };
  }
}

export function publicTicket(t: TicketRecord): Ticket & { replySentAt: string | null } {
  const { tenantId: _tenantId, ...rest } = t;
  return rest;
}
