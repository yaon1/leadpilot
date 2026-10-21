import { describe, expect, it } from 'vitest';
import { ROLE_PERMISSIONS, authorize, generateApiKey, hashKey } from '../../src/auth.js';
import { loadConfig } from '../../src/config.js';
import { HttpError } from '../../src/errors.js';
import { requestHash } from '../../src/idempotency.js';

describe('requestHash', () => {
  it('ignores key order and undefined fields', () => {
    expect(requestHash({ a: 1, b: { c: 2, d: 3 } })).toBe(requestHash({ b: { d: 3, c: 2 }, a: 1, e: undefined }));
  });
  it('changes when the payload changes', () => {
    expect(requestHash({ text: 'a' })).not.toBe(requestHash({ text: 'b' }));
  });
});

describe('auth', () => {
  const principal = (role: 'admin' | 'operator' | 'agent') => ({ keyId: 'k', tenantId: 't', tenantSlug: 'demo', role, name: role });

  it('agents can read and create CRM tasks but cannot approve tickets', () => {
    expect(() => authorize(principal('agent'), 'crm:write')).not.toThrow();
    const err = (() => {
      try {
        authorize(principal('agent'), 'tickets:review');
      } catch (e) {
        return e;
      }
    })();
    expect(err).toBeInstanceOf(HttpError);
    expect((err as HttpError).statusCode).toBe(403);
  });

  it('only admins manage the knowledge base', () => {
    expect(ROLE_PERMISSIONS.admin.has('kb:write')).toBe(true);
    expect(ROLE_PERMISSIONS.operator.has('kb:write')).toBe(false);
  });

  it('keys are random and only stored hashed', () => {
    const a = generateApiKey();
    expect(a).toMatch(/^lp_[\w-]{32}$/);
    expect(a).not.toBe(generateApiKey());
    expect(hashKey(a)).toHaveLength(64);
  });
});

describe('loadConfig', () => {
  it('defaults to the keyless mock setup', () => {
    const cfg = loadConfig({});
    expect(cfg.LLM_PROVIDER).toBe('mock');
    expect(cfg.CRM_PROVIDER).toBe('mock');
  });
  it('treats empty variables as unset', () => {
    expect(loadConfig({ BITRIX24_WEBHOOK_URL: '', PORT: '' }).PORT).toBe(3000);
  });
  it('fails fast when a provider is selected without credentials', () => {
    expect(() => loadConfig({ LLM_PROVIDER: 'anthropic' })).toThrow(/ANTHROPIC_API_KEY/);
    expect(() => loadConfig({ CRM_PROVIDER: 'bitrix24' })).toThrow(/BITRIX24_WEBHOOK_URL/);
  });
});
