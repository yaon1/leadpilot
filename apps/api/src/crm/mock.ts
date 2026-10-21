import type { CrmDeal, CrmTaskInput } from '@leadpilot/shared';
import type { Db } from '../db/pool.js';
import type { CrmAdapter, NewDeal } from './types.js';

/** CRM stand-in backed by Postgres tables, so the full flow works without credentials. */
export class MockCrmAdapter implements CrmAdapter {
  readonly name = 'mock';

  constructor(private readonly db: Db) {}

  async findDealByExternalId(tenantId: string, externalId: string): Promise<string | null> {
    const res = await this.db.query<{ id: string }>('SELECT id::text FROM mock_crm_deals WHERE tenant_id = $1 AND external_id = $2', [tenantId, externalId]);
    return res.rows[0]?.id ?? null;
  }

  async createDeal(tenantId: string, deal: NewDeal): Promise<string> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO mock_crm_deals (tenant_id, external_id, title, amount_rub, contact_name, phone, email)
       VALUES ($1, $2, $3, $4, $5, $6, $7)
       ON CONFLICT (tenant_id, external_id) DO UPDATE SET title = EXCLUDED.title
       RETURNING id::text`,
      [tenantId, deal.externalId, deal.title, deal.amountRub, deal.contact.name, deal.contact.phone, deal.contact.email],
    );
    const id = res.rows[0]!.id;
    await this.addNote(tenantId, id, deal.comment);
    return id;
  }

  async addNote(tenantId: string, dealId: string, text: string): Promise<void> {
    await this.db.query("INSERT INTO mock_crm_activities (tenant_id, deal_id, kind, text) VALUES ($1, $2, 'note', $3)", [tenantId, dealId, text]);
  }

  async searchDeals(tenantId: string, query: string, limit: number): Promise<CrmDeal[]> {
    const like = `%${query.replace(/[%_\\]/g, (c) => `\\${c}`)}%`;
    const res = await this.db.query<{
      id: string;
      title: string;
      stage: string;
      amount_rub: string | null;
      contact_name: string | null;
      phone: string | null;
      email: string | null;
      created_at: Date;
    }>(
      `SELECT id::text, title, stage, amount_rub, contact_name, phone, email, created_at FROM mock_crm_deals
        WHERE tenant_id = $1 AND ($2 = '%%' OR title ILIKE $2 OR contact_name ILIKE $2 OR phone ILIKE $2 OR email ILIKE $2)
        ORDER BY created_at DESC LIMIT $3`,
      [tenantId, like, limit],
    );
    return res.rows.map((r) => ({
      id: r.id,
      title: r.title,
      stage: r.stage,
      amountRub: r.amount_rub === null ? null : Number(r.amount_rub),
      contactName: r.contact_name,
      phone: r.phone,
      email: r.email,
      createdAt: r.created_at.toISOString(),
    }));
  }

  async createTask(tenantId: string, task: CrmTaskInput): Promise<{ id: string }> {
    const res = await this.db.query<{ id: string }>(
      `INSERT INTO mock_crm_activities (tenant_id, deal_id, kind, text, due_at)
       SELECT $1, d.id, 'task', $3, $4 FROM mock_crm_deals d WHERE d.tenant_id = $1 AND d.id::text = $2
       RETURNING id::text`,
      [tenantId, task.dealId, task.title, task.dueAt ?? null],
    );
    if (!res.rows[0]) throw new Error(`deal ${task.dealId} not found`);
    return { id: res.rows[0].id };
  }
}
