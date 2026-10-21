import type { CrmDeal, Extraction, KbSource, Stats, Ticket, TicketStatus } from '@leadpilot/shared';

export interface Session {
  apiUrl: string;
  apiKey: string;
}

export interface Me {
  tenant: string;
  role: 'admin' | 'operator' | 'agent';
  name: string;
}

export interface TicketEvent {
  id: number;
  type: string;
  actor: string;
  createdAt: string;
}

export type TicketDetail = Ticket & { events: TicketEvent[]; replySentAt: string | null };

const STORAGE_KEY = 'leadpilot.session';

export function loadSession(): Session | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    return raw ? (JSON.parse(raw) as Session) : null;
  } catch {
    return null;
  }
}

export function saveSession(s: Session | null): void {
  try {
    if (s) localStorage.setItem(STORAGE_KEY, JSON.stringify(s));
    else localStorage.removeItem(STORAGE_KEY);
  } catch {
    /* private mode: keep the session in memory only */
  }
}

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    message: string,
  ) {
    super(message);
  }
}

export function createApi(session: Session, fetchFn: typeof fetch = (...a) => fetch(...a)) {
  async function request<T>(path: string, init: { method?: string; body?: unknown; headers?: Record<string, string> } = {}): Promise<T> {
    const res = await fetchFn(`${session.apiUrl.replace(/\/$/, '')}${path}`, {
      method: init.method ?? 'GET',
      headers: {
        authorization: `Bearer ${session.apiKey}`,
        ...(init.body !== undefined ? { 'content-type': 'application/json' } : {}),
        ...init.headers,
      },
      body: init.body === undefined ? undefined : JSON.stringify(init.body),
    });
    if (res.status === 204) return undefined as T;
    const data = (await res.json().catch(() => ({}))) as { message?: string };
    if (!res.ok) throw new ApiError(res.status, data.message ?? res.statusText);
    return data as T;
  }

  return {
    me: () => request<Me>('/v1/me'),
    stats: () => request<Stats>('/v1/stats'),
    tickets: (status?: TicketStatus) => request<{ items: Ticket[] }>(`/v1/tickets${status ? `?status=${status}` : ''}`),
    ticket: (id: string) => request<TicketDetail>(`/v1/tickets/${id}`),
    approve: (id: string, body: { reply?: string; extraction?: Partial<Extraction> }) => request<Ticket>(`/v1/tickets/${id}/approve`, { method: 'POST', body }),
    reject: (id: string, reason: string) => request<Ticket>(`/v1/tickets/${id}/reject`, { method: 'POST', body: { reason } }),
    retry: (id: string) => request<Ticket>(`/v1/tickets/${id}/retry`, { method: 'POST', body: {} }),
    submit: (text: string, contact: Record<string, string>) =>
      request<{ ticketId: string }>('/v1/inbound', {
        method: 'POST',
        body: { channel: 'web', text, contact },
        headers: { 'idempotency-key': crypto.randomUUID() },
      }),
    documents: () => request<{ items: { id: string; title: string; chunks: number; createdAt: string }[] }>('/v1/kb/documents'),
    addDocument: (title: string, content: string) => request<{ id: string; chunks: number }>('/v1/kb/documents', { method: 'POST', body: { title, content } }),
    deleteDocument: (id: string) => request<void>(`/v1/kb/documents/${id}`, { method: 'DELETE' }),
    search: (q: string) => request<{ items: KbSource[] }>(`/v1/kb/search?q=${encodeURIComponent(q)}`),
    deals: (q = '') => request<{ adapter: string; items: CrmDeal[] }>(`/v1/crm/deals?q=${encodeURIComponent(q)}`),
  };
}

export type Api = ReturnType<typeof createApi>;
