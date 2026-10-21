import { describe, expect, it } from 'vitest';
import { AmoCrmAdapter } from '../../src/crm/amocrm.js';
import { Bitrix24Adapter } from '../../src/crm/bitrix24.js';
import { CrmError } from '../../src/crm/types.js';

type Call = { url: string; method: string; body: unknown; headers: Record<string, string> };

function fakeFetch(responder: (call: Call) => { status?: number; body?: unknown }) {
  const calls: Call[] = [];
  const fn = async (url: string, init?: RequestInit) => {
    const call = {
      url,
      method: init?.method ?? 'GET',
      body: init?.body ? JSON.parse(String(init.body)) : undefined,
      headers: (init?.headers ?? {}) as Record<string, string>,
    };
    calls.push(call);
    const r = responder(call);
    const status = r.status ?? 200;
    return new Response(status === 204 ? null : JSON.stringify(r.body ?? {}), { status });
  };
  return { fn, calls };
}

const deal = {
  externalId: '7d1c0a8e-1111-2222-3333-444455556666',
  title: 'Заявка: Интеграция с Битрикс24',
  amountRub: 150000,
  contact: { name: 'Анна', phone: '+79123456789', email: 'anna@shop.ru' },
  comment: 'Канал: web',
};

describe('Bitrix24Adapter', () => {
  it('reuses a duplicate contact and tags the deal with ORIGIN_ID', async () => {
    const { fn, calls } = fakeFetch(({ url }) => {
      if (url.endsWith('crm.duplicate.findbycomm.json')) return { body: { result: { CONTACT: [42] } } };
      if (url.endsWith('crm.deal.add.json')) return { body: { result: 1001 } };
      return { status: 404 };
    });
    const b24 = new Bitrix24Adapter('https://example.bitrix24.ru/rest/1/token', 1, fn);
    expect(await b24.createDeal('t', deal)).toBe('1001');
    expect(calls.map((c) => c.url.split('/').pop())).toEqual(['crm.duplicate.findbycomm.json', 'crm.deal.add.json']);
    expect(calls[1]!.body).toEqual({
      fields: {
        TITLE: deal.title,
        CONTACT_ID: '42',
        OPPORTUNITY: 150000,
        CURRENCY_ID: 'RUB',
        ORIGINATOR_ID: 'leadpilot',
        ORIGIN_ID: deal.externalId,
        COMMENTS: 'Канал: web',
      },
    });
  });

  it('creates a contact when there is no duplicate', async () => {
    const { fn, calls } = fakeFetch(({ url }) => {
      if (url.endsWith('crm.duplicate.findbycomm.json')) return { body: { result: [] } };
      if (url.endsWith('crm.contact.add.json')) return { body: { result: 7 } };
      return { body: { result: 1002 } };
    });
    await new Bitrix24Adapter('https://example.bitrix24.ru/rest/1/token/', 1, fn).createDeal('t', deal);
    expect(calls[1]!.body).toMatchObject({ fields: { NAME: 'Анна', PHONE: [{ VALUE: '+79123456789', VALUE_TYPE: 'WORK' }] } });
    expect(calls[2]!.body).toMatchObject({ fields: { CONTACT_ID: '7' } });
  });

  it('finds an existing deal by ORIGIN_ID (idempotent retry)', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { result: [{ ID: '555' }] } }));
    expect(await new Bitrix24Adapter('https://x/rest/1/t', 1, fn).findDealByExternalId('t', 'abc')).toBe('555');
    expect(calls[0]!.body).toMatchObject({ filter: { ORIGINATOR_ID: 'leadpilot', ORIGIN_ID: 'abc' } });
  });

  it('maps API errors: QUERY_LIMIT_EXCEEDED is retryable, others are not', async () => {
    const limited = new Bitrix24Adapter('https://x/rest/1/t', 1, fakeFetch(() => ({ body: { error: 'QUERY_LIMIT_EXCEEDED' } })).fn);
    await expect(limited.searchDeals('t', '', 5)).rejects.toMatchObject({ retryable: true });
    const denied = new Bitrix24Adapter('https://x/rest/1/t', 1, fakeFetch(() => ({ status: 401, body: { error: 'invalid_token' } })).fn);
    const err = await denied.searchDeals('t', '', 5).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(CrmError);
    expect((err as CrmError).retryable).toBe(false);
  });

  it('links tasks to the deal', async () => {
    const { fn, calls } = fakeFetch(() => ({ body: { result: { task: { id: 9 } } } }));
    expect(await new Bitrix24Adapter('https://x/rest/1/t', 5, fn).createTask('t', { dealId: '1001', title: 'Перезвонить' })).toEqual({ id: '9' });
    expect(calls[0]!.body).toEqual({ fields: { TITLE: 'Перезвонить', RESPONSIBLE_ID: 5, UF_CRM_TASK: ['D_1001'] } });
  });
});

describe('AmoCrmAdapter', () => {
  it('creates lead + contact via /leads/complex and adds a note', async () => {
    const { fn, calls } = fakeFetch(({ url }) => (url.endsWith('/leads/complex') ? { body: [{ id: 3001, contact_id: 1 }] } : { body: {} }));
    const amo = new AmoCrmAdapter('https://demo.amocrm.ru/', 'tok', fn);
    expect(await amo.createDeal('t', deal)).toBe('3001');
    expect(calls[0]!.headers.authorization).toBe('Bearer tok');
    expect(calls[0]!.body).toEqual([
      {
        name: `${deal.title} [LP-7d1c0a8e]`,
        price: 150000,
        _embedded: {
          contacts: [
            {
              first_name: 'Анна',
              custom_fields_values: [
                { field_code: 'PHONE', values: [{ value: '+79123456789', enum_code: 'WORK' }] },
                { field_code: 'EMAIL', values: [{ value: 'anna@shop.ru', enum_code: 'WORK' }] },
              ],
            },
          ],
        },
      },
    ]);
    expect(calls[1]!.url).toBe('https://demo.amocrm.ru/api/v4/leads/3001/notes');
  });

  it('treats 204 No Content as an empty search result', async () => {
    const amo = new AmoCrmAdapter('https://demo.amocrm.ru', 'tok', fakeFetch(() => ({ status: 204 })).fn);
    expect(await amo.searchDeals('t', 'nothing', 10)).toEqual([]);
    expect(await amo.findDealByExternalId('t', deal.externalId)).toBeNull();
  });

  it('marks 429 and 5xx as retryable', async () => {
    const amo = new AmoCrmAdapter('https://demo.amocrm.ru', 'tok', fakeFetch(() => ({ status: 429 })).fn);
    await expect(amo.searchDeals('t', '', 1)).rejects.toMatchObject({ retryable: true });
  });
});
