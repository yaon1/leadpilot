import type { CrmDeal, CrmTaskInput } from '@leadpilot/shared';
import { ensureOk, type CrmAdapter, type FetchLike, type NewDeal } from './types.js';

interface AmoLead {
  id: number;
  name: string;
  price: number | null;
  status_id: number;
  created_at: number;
}

/**
 * amoCRM API v4 with a long-lived access token. Leads are created with
 * /leads/complex (lead + contact in one call); the ticket reference is part of
 * the lead name, which makes the lookup on retry possible via ?query=.
 */
export class AmoCrmAdapter implements CrmAdapter {
  readonly name = 'amocrm';

  constructor(
    private readonly baseUrl: string,
    private readonly accessToken: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  private async request<T>(path: string, init: { method?: string; body?: unknown } = {}): Promise<T | null> {
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}/api/v4${path}`, {
      method: init.method ?? 'GET',
      headers: { authorization: `Bearer ${this.accessToken}`, 'content-type': 'application/json' },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 204) return null; // amoCRM answers "no content" for empty search results
    await ensureOk(res, `amocrm ${init.method ?? 'GET'} ${path.split('?')[0]}`);
    return (await res.json()) as T;
  }

  static ref(externalId: string): string {
    return `LP-${externalId.slice(0, 8)}`;
  }

  async findDealByExternalId(_tenantId: string, externalId: string): Promise<string | null> {
    const ref = AmoCrmAdapter.ref(externalId);
    const res = await this.request<{ _embedded: { leads: AmoLead[] } }>(`/leads?query=${encodeURIComponent(ref)}&limit=5`);
    const lead = res?._embedded.leads.find((l) => l.name.includes(ref));
    return lead ? String(lead.id) : null;
  }

  async createDeal(_tenantId: string, deal: NewDeal): Promise<string> {
    const fields = [
      ...(deal.contact.phone ? [{ field_code: 'PHONE', values: [{ value: deal.contact.phone, enum_code: 'WORK' }] }] : []),
      ...(deal.contact.email ? [{ field_code: 'EMAIL', values: [{ value: deal.contact.email, enum_code: 'WORK' }] }] : []),
    ];
    const hasContact = Boolean(deal.contact.name || fields.length);
    const res = await this.request<{ id: number }[]>('/leads/complex', {
      method: 'POST',
      body: [
        {
          name: `${deal.title} [${AmoCrmAdapter.ref(deal.externalId)}]`,
          ...(deal.amountRub !== null ? { price: deal.amountRub } : {}),
          ...(hasContact
            ? { _embedded: { contacts: [{ first_name: deal.contact.name ?? 'Клиент', ...(fields.length ? { custom_fields_values: fields } : {}) }] } }
            : {}),
        },
      ],
    });
    const id = String(res![0]!.id);
    await this.addNote(_tenantId, id, deal.comment);
    return id;
  }

  async addNote(_tenantId: string, dealId: string, text: string): Promise<void> {
    await this.request(`/leads/${dealId}/notes`, { method: 'POST', body: [{ note_type: 'common', params: { text } }] });
  }

  async searchDeals(_tenantId: string, query: string, limit: number): Promise<CrmDeal[]> {
    const qs = new URLSearchParams({ limit: String(limit), ...(query ? { query } : {}) });
    const res = await this.request<{ _embedded: { leads: AmoLead[] } }>(`/leads?${qs}`);
    return (res?._embedded.leads ?? []).map((l) => ({
      id: String(l.id),
      title: l.name,
      stage: String(l.status_id),
      amountRub: l.price ?? null,
      contactName: null,
      phone: null,
      email: null,
      createdAt: new Date(l.created_at * 1000).toISOString(),
    }));
  }

  async createTask(_tenantId: string, task: CrmTaskInput): Promise<{ id: string }> {
    const due = task.dueAt ? new Date(task.dueAt) : new Date(Date.now() + 24 * 3600 * 1000);
    const res = await this.request<{ _embedded: { tasks: { id: number }[] } }>('/tasks', {
      method: 'POST',
      body: [{ text: task.title, complete_till: Math.floor(due.getTime() / 1000), entity_id: Number(task.dealId), entity_type: 'leads' }],
    });
    return { id: String(res!._embedded.tasks[0]!.id) };
  }
}
