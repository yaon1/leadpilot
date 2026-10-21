import { afterAll, beforeAll, describe, expect, it } from 'vitest';
import { syncTicketToCrm } from '../../src/pipeline/sync-crm.js';
import { startEnv, waitFor, type TestEnv } from './setup.js';

let env: TestEnv;
beforeAll(async () => {
  env = await startEnv();
});
afterAll(async () => {
  await env?.stop();
});

const auth = (key: string) => ({ authorization: `Bearer ${key}` });

async function inbound(key: string, idem: string, payload: object) {
  return env.app.inject({ method: 'POST', url: '/v1/inbound', headers: { ...auth(key), 'idempotency-key': idem }, payload });
}

async function ticketWithStatus(id: string, status: string) {
  return waitFor(async () => {
    const t = await env.tickets.get(id);
    return t?.status === status ? t : null;
  });
}

const LEAD = {
  channel: 'web',
  text: 'Здравствуйте! Меня зовут Анна. Сколько стоит интеграция сайта с Битрикс24? Бюджет 150к. Телефон 8 (912) 345-67-89',
  contact: { email: 'anna@shop.ru' },
};

describe('auth', () => {
  it('rejects missing and invalid keys', async () => {
    expect((await env.app.inject({ method: 'GET', url: '/v1/tickets' })).statusCode).toBe(401);
    expect((await env.app.inject({ method: 'GET', url: '/v1/tickets', headers: auth('lp_nope') })).statusCode).toBe(401);
  });
});

describe('end-to-end: web lead -> AI -> human approval -> CRM', () => {
  let ticketId: string;

  it('accepts the message and replays the same response for a retried request', async () => {
    const first = await inbound(env.keys.agent, 'form-123', LEAD);
    expect(first.statusCode).toBe(202);
    ticketId = first.json().ticketId;

    const retry = await inbound(env.keys.agent, 'form-123', LEAD);
    expect(retry.statusCode).toBe(202);
    expect(retry.headers['idempotent-replayed']).toBe('true');
    expect(retry.json().ticketId).toBe(ticketId);

    const misuse = await inbound(env.keys.agent, 'form-123', { ...LEAD, text: 'другой текст' });
    expect(misuse.statusCode).toBe(422);
    expect(misuse.json().error).toBe('idempotency_key_reused');
  });

  it('requires an idempotency key', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/v1/inbound', headers: auth(env.keys.agent), payload: LEAD });
    expect(res.statusCode).toBe(400);
  });

  it('extracts fields, retrieves knowledge and drafts a reply (with one retry-with-error)', async () => {
    const t = await ticketWithStatus(ticketId, 'awaiting_review');
    expect(t.extraction).toMatchObject({
      intent: 'new_lead',
      customerName: 'Анна',
      phone: '+79123456789',
      email: 'anna@shop.ru', // from channel metadata
      budgetRub: 150000,
      product: 'Интеграция с Битрикс24',
    });
    expect(t.sources[0]?.title).toBe('Интеграция с Битрикс24: стоимость и сроки');
    expect(t.draft?.reply).toContain('35 000');
    expect(t.draft?.sourceIds).toEqual([1]);
    expect(t.llmAttempts).toBe(4); // mock answers invalid JSON first for both extraction and draft
  });

  it('does not let an agent approve, and isolates tenants', async () => {
    const res = await env.app.inject({ method: 'POST', url: `/v1/tickets/${ticketId}/approve`, headers: auth(env.keys.agent), payload: {} });
    expect(res.statusCode).toBe(403);
    const other = await env.app.inject({ method: 'GET', url: `/v1/tickets/${ticketId}`, headers: auth(env.keys.otherTenant) });
    expect(other.statusCode).toBe(404);
  });

  it('operator approves with an edited reply; the deal lands in the CRM exactly once', async () => {
    const res = await env.app.inject({
      method: 'POST',
      url: `/v1/tickets/${ticketId}/approve`,
      headers: auth(env.keys.operator),
      payload: { reply: 'Анна, добрый день! Интеграция с Битрикс24 — от 35 000 ₽, срок от 5 рабочих дней.' },
    });
    expect(res.statusCode).toBe(200);
    expect(res.json().status).toBe('approved');

    const again = await env.app.inject({ method: 'POST', url: `/v1/tickets/${ticketId}/approve`, headers: auth(env.keys.operator), payload: {} });
    expect(again.statusCode).toBe(409);

    const synced = await ticketWithStatus(ticketId, 'synced');
    expect(synced.crmDealId).toBeTruthy();
    expect(synced.replySentAt).toBeTruthy();

    const deals = await env.app.inject({ method: 'GET', url: '/v1/crm/deals?q=Битрикс', headers: auth(env.keys.agent) });
    expect(deals.json().items).toHaveLength(1);
    expect(deals.json().items[0]).toMatchObject({ amountRub: 150000, phone: '+79123456789', contactName: 'Анна' });

    const detail = await env.app.inject({ method: 'GET', url: `/v1/tickets/${ticketId}`, headers: auth(env.keys.operator) });
    expect(detail.json().events.map((e: { type: string }) => e.type)).toEqual(['status:awaiting_review', 'status:approved', 'reply_edited', 'status:synced']);
  });

  it('an agent (e.g. via MCP) can create a follow-up task on the deal', async () => {
    const t = await env.tickets.get(ticketId);
    const res = await env.app.inject({
      method: 'POST',
      url: '/v1/crm/tasks',
      headers: auth(env.keys.agent),
      payload: { dealId: t!.crmDealId, title: 'Перезвонить Анне', dueAt: '2026-11-01T10:00:00Z' },
    });
    expect(res.statusCode).toBe(201);
  });
});

describe('sync is safe to repeat', () => {
  it('does not create a second deal when a retried job finds the deal already in the CRM', async () => {
    const res = await inbound(env.keys.agent, 'crash-test', { channel: 'api', text: 'Хочу заказать лендинг, бюджет 60 000 руб' });
    const id = res.json().ticketId as string;
    await ticketWithStatus(id, 'awaiting_review');

    // Simulate: the deal was created in the CRM, but the worker crashed before saving its id.
    await env.crm.createDeal(env.tenantId, { externalId: id, title: 'pre-existing', amountRub: null, contact: { name: null, phone: null, email: null }, comment: '' });
    await env.tickets.transition(id, ['awaiting_review'], 'approved', { final_reply: 'ok' });

    const sender = { sendTelegram: async () => {} };
    // Run the sync twice by hand, in addition to the background worker's run: still one deal.
    await syncTicketToCrm({ tickets: env.tickets, crm: env.crm, sender }, id);
    await syncTicketToCrm({ tickets: env.tickets, crm: env.crm, sender }, id);
    await ticketWithStatus(id, 'synced');
    const count = await env.db.query('SELECT count(*)::int AS n FROM mock_crm_deals WHERE external_id = $1', [id]);
    expect(count.rows[0].n).toBe(1);
  });
});

describe('concurrency', () => {
  it('parallel requests with one key create exactly one ticket', async () => {
    const payload = { channel: 'web', text: 'Нужен Telegram-бот для записи клиентов' };
    const results = await Promise.all(Array.from({ length: 8 }, () => inbound(env.keys.agent, 'burst-1', payload)));
    const codes = results.map((r) => r.statusCode);
    expect(codes.every((c) => c === 202 || c === 409)).toBe(true);
    const ids = new Set(results.filter((r) => r.statusCode === 202).map((r) => r.json().ticketId));
    expect(ids.size).toBe(1);
    const n = await env.db.query("SELECT count(*)::int AS n FROM tickets WHERE external_id = 'idem:burst-1'");
    expect(n.rows[0].n).toBe(1);
  });
});

describe('spam', () => {
  it('confident spam is auto-rejected without drafting a reply', async () => {
    const res = await inbound(env.keys.agent, 'spam-1', { channel: 'email', text: 'Предлагаем услуги SEO, раскрутка и продвижение вашего сайта, бесплатный аудит!' });
    const t = await ticketWithStatus(res.json().ticketId, 'rejected');
    expect(t.extraction?.intent).toBe('spam');
    expect(t.draft).toBeNull();
  });
});

describe('telegram channel', () => {
  const update = (id: number) => ({
    update_id: id,
    message: { message_id: 1, chat: { id: 555 }, from: { first_name: 'Олег' }, text: 'Добрый день! Сколько стоит бот для приёма заявок?' },
  });

  it('checks the webhook secret', async () => {
    const res = await env.app.inject({ method: 'POST', url: '/v1/channels/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': 'wrong' }, payload: update(1) });
    expect(res.statusCode).toBe(401);
  });

  it('deduplicates redelivered updates and replies in Telegram after approval', async () => {
    const send = () =>
      env.app.inject({ method: 'POST', url: '/v1/channels/telegram/webhook', headers: { 'x-telegram-bot-api-secret-token': 'tg-secret' }, payload: update(9001) });
    const [a, b] = [await send(), await send()];
    expect(a.statusCode).toBe(200);
    expect(b.json().ticketId).toBe(a.json().ticketId);

    const id = a.json().ticketId as string;
    const t = await ticketWithStatus(id, 'awaiting_review');
    expect(t.extraction?.customerName).toBe('Олег');
    await env.app.inject({ method: 'POST', url: `/v1/tickets/${id}/approve`, headers: auth(env.keys.operator), payload: {} });
    await ticketWithStatus(id, 'synced');
    expect(env.sent).toEqual([{ chatId: '555', text: t.draft!.reply }]);
  });
});

describe('knowledge base & observability', () => {
  it('admin adds a document, operator cannot; search finds it', async () => {
    const doc = { title: 'Скидки', content: 'Для некоммерческих организаций скидка 15% на все работы.' };
    expect((await env.app.inject({ method: 'POST', url: '/v1/kb/documents', headers: auth(env.keys.operator), payload: doc })).statusCode).toBe(403);
    expect((await env.app.inject({ method: 'POST', url: '/v1/kb/documents', headers: auth(env.keys.admin), payload: doc })).statusCode).toBe(201);
    const res = await env.app.inject({ method: 'GET', url: `/v1/kb/search?q=${encodeURIComponent('скидка для некоммерческих')}`, headers: auth(env.keys.agent) });
    expect(res.json().items[0].title).toBe('Скидки');
  });

  it('exposes stats, health and Prometheus metrics', async () => {
    const stats = await env.app.inject({ method: 'GET', url: '/v1/stats', headers: auth(env.keys.operator) });
    expect(stats.json().byStatus.synced).toBeGreaterThanOrEqual(2);
    expect((await env.app.inject({ method: 'GET', url: '/readyz' })).json()).toMatchObject({ status: 'ok' });
    const metrics = (await env.app.inject({ method: 'GET', url: '/metrics' })).body;
    expect(metrics).toContain('leadpilot_inbound_total{channel="web",outcome="accepted"}');
    expect(metrics).toContain('leadpilot_llm_requests_total{provider="mock",task="extract",outcome="invalid"}');
  });
});
