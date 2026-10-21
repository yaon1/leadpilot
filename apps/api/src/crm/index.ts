import type { Config } from '../config.js';
import type { Db } from '../db/pool.js';
import { crmRequestsTotal } from '../metrics.js';
import { withSpan } from '../telemetry.js';
import { AmoCrmAdapter } from './amocrm.js';
import { Bitrix24Adapter } from './bitrix24.js';
import { MockCrmAdapter } from './mock.js';
import type { CrmAdapter } from './types.js';

export * from './types.js';

export function createCrmAdapter(cfg: Config, db: Db): CrmAdapter {
  const adapter =
    cfg.CRM_PROVIDER === 'bitrix24'
      ? new Bitrix24Adapter(cfg.BITRIX24_WEBHOOK_URL!, cfg.BITRIX24_RESPONSIBLE_ID)
      : cfg.CRM_PROVIDER === 'amocrm'
        ? new AmoCrmAdapter(cfg.AMOCRM_BASE_URL!, cfg.AMOCRM_ACCESS_TOKEN!)
        : new MockCrmAdapter(db);
  return instrument(adapter);
}

/** Wraps every adapter method with a span and a Prometheus counter. */
export function instrument(adapter: CrmAdapter): CrmAdapter {
  return new Proxy(adapter, {
    get(target, prop, receiver) {
      const value = Reflect.get(target, prop, receiver) as unknown;
      if (typeof value !== 'function') return value;
      const operation = String(prop);
      return async (...args: unknown[]) =>
        withSpan(`crm.${operation}`, { 'crm.adapter': target.name }, async () => {
          try {
            const result = await (value as (...a: unknown[]) => Promise<unknown>).apply(target, args);
            crmRequestsTotal.inc({ adapter: target.name, operation, outcome: 'ok' });
            return result;
          } catch (err) {
            crmRequestsTotal.inc({ adapter: target.name, operation, outcome: 'error' });
            throw err;
          }
        });
    },
  });
}
