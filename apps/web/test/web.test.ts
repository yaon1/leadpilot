import { mount } from '@vue/test-utils';
import { describe, expect, it, vi } from 'vitest';
import { ApiError, createApi } from '../src/api';
import IntentBadge from '../src/components/IntentBadge.vue';
import StatusBadge from '../src/components/StatusBadge.vue';
import { formatRub, timeAgo } from '../src/format';

describe('format', () => {
  it('formats rubles and missing values', () => {
    expect(formatRub(150000).replace(/\s/g, ' ')).toBe('150 000 ₽');
    expect(formatRub(null)).toBe('—');
  });
  it('formats relative time', () => {
    const now = Date.parse('2026-10-22T12:00:00Z');
    expect(timeAgo('2026-10-22T11:59:30Z', now)).toBe('30 с назад');
    expect(timeAgo('2026-10-22T11:15:00Z', now)).toBe('45 мин назад');
    expect(timeAgo('2026-10-22T09:00:00Z', now)).toBe('3 ч назад');
  });
});

describe('badges', () => {
  it('renders status text, not only color', () => {
    expect(mount(StatusBadge, { props: { status: 'awaiting_review' } }).text()).toBe('Ждёт проверки');
  });
  it('marks urgent tickets', () => {
    const w = mount(IntentBadge, { props: { intent: 'support', urgency: 'high' } });
    expect(w.text()).toContain('Поддержка');
    expect(w.text()).toContain('срочно');
  });
});

describe('api client', () => {
  it('sends the bearer key and a fresh idempotency key per submission', async () => {
    const fetchFn = vi.fn(async () => new Response(JSON.stringify({ ticketId: 't' }), { status: 202 }));
    const api = createApi({ apiUrl: '/api/', apiKey: 'lp_x' }, fetchFn as unknown as typeof fetch);
    await api.submit('hi', {});
    await api.submit('hi', {});
    const calls = fetchFn.mock.calls as unknown as [string, RequestInit][];
    expect(calls[0]![0]).toBe('/api/v1/inbound');
    const h0 = calls[0]![1].headers as Record<string, string>;
    const h1 = calls[1]![1].headers as Record<string, string>;
    expect(h0.authorization).toBe('Bearer lp_x');
    expect(h0['idempotency-key']).not.toBe(h1['idempotency-key']);
  });

  it('surfaces API error messages', async () => {
    const fetchFn = async () => new Response(JSON.stringify({ message: 'ticket is synced, expected awaiting_review' }), { status: 409 });
    const api = createApi({ apiUrl: '/api', apiKey: 'k' }, fetchFn as unknown as typeof fetch);
    const err = await api.approve('1', {}).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(ApiError);
    expect((err as ApiError).status).toBe(409);
    expect((err as ApiError).message).toContain('expected awaiting_review');
  });
});
