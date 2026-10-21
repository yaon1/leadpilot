import { Client } from '@modelcontextprotocol/sdk/client/index.js';
import { InMemoryTransport } from '@modelcontextprotocol/sdk/inMemory.js';
import { afterEach, describe, expect, it } from 'vitest';
import { LeadpilotClient } from '../src/client.js';
import { createServer } from '../src/server.js';

type Call = { url: string; method: string; headers: Record<string, string>; body: unknown };

async function connect(responder: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fetchFn = async (url: string, init?: RequestInit) => {
    const call = { url, method: init?.method ?? 'GET', headers: (init?.headers ?? {}) as Record<string, string>, body: init?.body ? JSON.parse(String(init.body)) : undefined };
    calls.push(call);
    const r = responder(call);
    return new Response(JSON.stringify(r.body ?? {}), { status: r.status ?? 200 });
  };
  const server = createServer(new LeadpilotClient('http://api.test/', 'lp_agent', fetchFn));
  const client = new Client({ name: 'test', version: '1.0.0' });
  const [a, b] = InMemoryTransport.createLinkedPair();
  await Promise.all([server.connect(a), client.connect(b)]);
  cleanup = async () => {
    await client.close();
    await server.close();
  };
  return { client, calls };
}

let cleanup: (() => Promise<void>) | undefined;
afterEach(async () => {
  await cleanup?.();
  cleanup = undefined;
});

const text = (r: unknown) => (r as { content: { text: string }[] }).content[0]!.text;

describe('leadpilot MCP server', () => {
  it('lists the tools with read-only hints', async () => {
    const { client } = await connect(() => ({}));
    const { tools } = await client.listTools();
    expect(tools.map((t) => t.name).sort()).toEqual(['create_crm_task', 'get_ticket', 'list_tickets', 'search_deals', 'search_knowledge_base', 'submit_message']);
    expect(tools.find((t) => t.name === 'search_deals')?.annotations?.readOnlyHint).toBe(true);
    expect(tools.find((t) => t.name === 'create_crm_task')?.annotations?.readOnlyHint).toBe(false);
  });

  it('search_deals calls the API with the agent key', async () => {
    const { client, calls } = await connect(() => ({ body: { adapter: 'mock', items: [{ id: '1', title: 'Заявка: Лендинг' }] } }));
    const res = await client.callTool({ name: 'search_deals', arguments: { query: 'Лендинг' } });
    expect(calls[0]!.url).toBe('http://api.test/v1/crm/deals?q=%D0%9B%D0%B5%D0%BD%D0%B4%D0%B8%D0%BD%D0%B3&limit=10');
    expect(calls[0]!.headers.authorization).toBe('Bearer lp_agent');
    expect(JSON.parse(text(res)).items[0].title).toBe('Заявка: Лендинг');
  });

  it('list_tickets returns a compact view for the model', async () => {
    const ticket = {
      id: 'a',
      status: 'awaiting_review',
      channel: 'telegram',
      text: 'Сколько стоит бот?',
      extraction: { intent: 'new_lead', urgency: 'normal', summary: 'Спрашивает цену бота' },
      crmDealId: null,
      createdAt: '2026-10-22T10:00:00Z',
    };
    const { client, calls } = await connect(() => ({ body: { items: [ticket] } }));
    const res = await client.callTool({ name: 'list_tickets', arguments: { status: 'awaiting_review' } });
    expect(calls[0]!.url).toContain('status=awaiting_review');
    expect(JSON.parse(text(res))).toEqual([
      { id: 'a', status: 'awaiting_review', channel: 'telegram', intent: 'new_lead', urgency: 'normal', summary: 'Спрашивает цену бота', crmDealId: null, createdAt: '2026-10-22T10:00:00Z' },
    ]);
  });

  it('submit_message uses a deterministic idempotency key', async () => {
    const { client, calls } = await connect(() => ({ status: 202, body: { ticketId: 't1', status: 'received', duplicate: false } }));
    const args = { text: 'Клиент звонил, хочет интеграцию с amoCRM', phone: '+79990000000' };
    await client.callTool({ name: 'submit_message', arguments: args });
    await client.callTool({ name: 'submit_message', arguments: args });
    expect(calls[0]!.headers['idempotency-key']).toMatch(/^mcp-[0-9a-f]{32}$/);
    expect(calls[1]!.headers['idempotency-key']).toBe(calls[0]!.headers['idempotency-key']);
    expect(calls[0]!.body).toEqual({ channel: 'api', text: args.text, contact: { phone: '+79990000000' } });
  });

  it('returns API errors to the model as tool errors', async () => {
    const { client } = await connect(() => ({ status: 403, body: { error: 'forbidden', message: "role 'agent' lacks permission" } }));
    const res = await client.callTool({ name: 'create_crm_task', arguments: { dealId: '1', title: 'Перезвонить' } });
    expect(res.isError).toBe(true);
    expect(text(res)).toContain('403');
  });

  it('validates tool input before calling the API', async () => {
    const { client, calls } = await connect(() => ({}));
    const res = await client.callTool({ name: 'get_ticket', arguments: { id: 'not-a-uuid' } });
    expect(res.isError).toBe(true);
    expect(calls).toHaveLength(0);
  });
});
