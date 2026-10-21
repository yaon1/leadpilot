import type { CrmDeal, CrmTaskInput, KbSource, Ticket, TicketStatus } from '@leadpilot/shared';

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

export class LeadpilotApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

/** Thin typed client for the LeadPilot REST API, authenticated with an `agent` API key. */
export class LeadpilotClient {
  constructor(
    private readonly baseUrl: string,
    private readonly apiKey: string,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  private async request<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const res = await this.fetchFn(`${this.baseUrl.replace(/\/$/, '')}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${this.apiKey}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    const text = await res.text();
    const data = text ? (JSON.parse(text) as unknown) : null;
    if (!res.ok) {
      const msg = (data as { message?: string } | null)?.message ?? res.statusText;
      throw new LeadpilotApiError(res.status, `${res.status}: ${msg}`);
    }
    return data as T;
  }

  listTickets(params: { status?: TicketStatus; limit?: number }) {
    const qs = new URLSearchParams();
    if (params.status) qs.set('status', params.status);
    if (params.limit) qs.set('limit', String(params.limit));
    return this.request<{ items: Ticket[] }>(`/v1/tickets?${qs}`);
  }

  getTicket(id: string) {
    return this.request<Ticket & { events: unknown[] }>(`/v1/tickets/${encodeURIComponent(id)}`);
  }

  searchDeals(query: string, limit = 10) {
    return this.request<{ adapter: string; items: CrmDeal[] }>(`/v1/crm/deals?${new URLSearchParams({ q: query, limit: String(limit) })}`);
  }

  createTask(task: CrmTaskInput) {
    return this.request<{ id: string }>('/v1/crm/tasks', { method: 'POST', body: task });
  }

  searchKnowledgeBase(query: string, limit = 5) {
    return this.request<{ items: KbSource[] }>(`/v1/kb/search?${new URLSearchParams({ q: query, limit: String(limit) })}`);
  }

  submitMessage(body: { channel: 'api'; text: string; contact: Record<string, string> }, idempotencyKey: string) {
    return this.request<{ ticketId: string; status: string; duplicate: boolean }>('/v1/inbound', {
      method: 'POST',
      body,
      headers: { 'idempotency-key': idempotencyKey },
    });
  }
}
