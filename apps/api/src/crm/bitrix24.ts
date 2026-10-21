import type { CrmDeal, CrmTaskInput } from '@leadpilot/shared';
import { CrmError, ensureOk, type CrmAdapter, type FetchLike, type NewDeal } from './types.js';

interface B24Deal {
  ID: string;
  TITLE: string;
  STAGE_ID: string;
  OPPORTUNITY: string | null;
  DATE_CREATE: string;
  CONTACT_ID: string | null;
}

/**
 * Bitrix24 REST via an inbound webhook URL (https://<portal>/rest/<user>/<token>/).
 * Deals are tagged with ORIGINATOR_ID/ORIGIN_ID, which makes "create" idempotent:
 * a retried sync looks the deal up by ORIGIN_ID first.
 */
export class Bitrix24Adapter implements CrmAdapter {
  readonly name = 'bitrix24';
  static readonly ORIGINATOR = 'leadpilot';

  constructor(
    private readonly webhookUrl: string,
    private readonly responsibleId = 1,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  private async call<T>(method: string, params: Record<string, unknown>): Promise<T> {
    const base = this.webhookUrl.endsWith('/') ? this.webhookUrl : `${this.webhookUrl}/`;
    const res = await this.fetchFn(`${base}${method}.json`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify(params),
    });
    await ensureOk(res, `bitrix24 ${method}`);
    const body = (await res.json()) as { result?: T; error?: string; error_description?: string };
    if (body.error) {
      throw new CrmError(`bitrix24 ${method}: ${body.error} ${body.error_description ?? ''}`.trim(), body.error === 'QUERY_LIMIT_EXCEEDED');
    }
    return body.result as T;
  }

  async findDealByExternalId(_tenantId: string, externalId: string): Promise<string | null> {
    const deals = await this.call<B24Deal[]>('crm.deal.list', {
      filter: { ORIGINATOR_ID: Bitrix24Adapter.ORIGINATOR, ORIGIN_ID: externalId },
      select: ['ID'],
    });
    return deals[0]?.ID ?? null;
  }

  private async findOrCreateContact(contact: NewDeal['contact']): Promise<string | null> {
    if (!contact.phone && !contact.email && !contact.name) return null;
    if (contact.phone || contact.email) {
      const dup = await this.call<{ CONTACT?: string[] }>('crm.duplicate.findbycomm', {
        type: contact.phone ? 'PHONE' : 'EMAIL',
        values: [contact.phone ?? contact.email],
        entity_type: 'CONTACT',
      });
      const existing = dup.CONTACT?.[0];
      if (existing) return String(existing);
    }
    const id = await this.call<number>('crm.contact.add', {
      fields: {
        NAME: contact.name ?? 'Клиент',
        ...(contact.phone ? { PHONE: [{ VALUE: contact.phone, VALUE_TYPE: 'WORK' }] } : {}),
        ...(contact.email ? { EMAIL: [{ VALUE: contact.email, VALUE_TYPE: 'WORK' }] } : {}),
        SOURCE_ID: 'WEB',
      },
    });
    return String(id);
  }

  async createDeal(_tenantId: string, deal: NewDeal): Promise<string> {
    const contactId = await this.findOrCreateContact(deal.contact);
    const id = await this.call<number>('crm.deal.add', {
      fields: {
        TITLE: deal.title,
        ...(contactId ? { CONTACT_ID: contactId } : {}),
        ...(deal.amountRub !== null ? { OPPORTUNITY: deal.amountRub, CURRENCY_ID: 'RUB' } : {}),
        ORIGINATOR_ID: Bitrix24Adapter.ORIGINATOR,
        ORIGIN_ID: deal.externalId,
        COMMENTS: deal.comment,
      },
    });
    return String(id);
  }

  async addNote(_tenantId: string, dealId: string, text: string): Promise<void> {
    await this.call('crm.timeline.comment.add', { fields: { ENTITY_ID: Number(dealId), ENTITY_TYPE: 'deal', COMMENT: text } });
  }

  async searchDeals(_tenantId: string, query: string, limit: number): Promise<CrmDeal[]> {
    const deals = await this.call<B24Deal[]>('crm.deal.list', {
      filter: query ? { '%TITLE': query } : {},
      select: ['ID', 'TITLE', 'STAGE_ID', 'OPPORTUNITY', 'DATE_CREATE', 'CONTACT_ID'],
      order: { DATE_CREATE: 'DESC' },
    });
    return deals.slice(0, limit).map((d) => ({
      id: d.ID,
      title: d.TITLE,
      stage: d.STAGE_ID,
      amountRub: d.OPPORTUNITY ? Number(d.OPPORTUNITY) : null,
      contactName: null,
      phone: null,
      email: null,
      createdAt: new Date(d.DATE_CREATE).toISOString(),
    }));
  }

  async createTask(_tenantId: string, task: CrmTaskInput): Promise<{ id: string }> {
    const res = await this.call<{ task: { id: string } }>('tasks.task.add', {
      fields: {
        TITLE: task.title,
        RESPONSIBLE_ID: this.responsibleId,
        UF_CRM_TASK: [`D_${task.dealId}`],
        ...(task.dueAt ? { DEADLINE: task.dueAt } : {}),
      },
    });
    return { id: String(res.task.id) };
  }
}
