import { describe, expect, it } from 'vitest';
import { DraftReplySchema, ExtractionSchema, InboundMessageSchema, normalizePhone } from '../src/index.js';

describe('normalizePhone', () => {
  it.each([
    ['8 (999) 123-45-67', '+79991234567'],
    ['+7 999 123 45 67', '+79991234567'],
    ['9991234567', '+79991234567'],
    ['+66 82 168 9491', '+66821689491'],
  ])('%s -> %s', (input, expected) => {
    expect(normalizePhone(input)).toBe(expected);
  });

  it('rejects garbage', () => {
    expect(normalizePhone('call me')).toBeNull();
    expect(normalizePhone('123')).toBeNull();
    expect(normalizePhone(undefined)).toBeNull();
  });
});

describe('ExtractionSchema', () => {
  const valid = {
    intent: 'new_lead',
    confidence: 0.9,
    summary: 'Wants a quote',
    customerName: 'Ivan',
    phone: '+79991234567',
    email: null,
    product: 'CRM integration',
    budgetRub: 150000,
    urgency: 'normal',
  };

  it('accepts a valid extraction', () => {
    expect(ExtractionSchema.safeParse(valid).success).toBe(true);
  });

  it('rejects a non-normalized phone with a readable message', () => {
    const r = ExtractionSchema.safeParse({ ...valid, phone: '8 999 123-45-67' });
    expect(r.success).toBe(false);
    expect(r.error?.issues[0]?.message).toContain('E.164');
  });

  it('rejects unknown intents and out-of-range confidence', () => {
    expect(ExtractionSchema.safeParse({ ...valid, intent: 'buy' }).success).toBe(false);
    expect(ExtractionSchema.safeParse({ ...valid, confidence: 1.5 }).success).toBe(false);
  });
});

describe('InboundMessageSchema', () => {
  it('trims text and defaults contact', () => {
    const r = InboundMessageSchema.parse({ channel: 'web', text: '  hi  ' });
    expect(r.text).toBe('hi');
    expect(r.contact).toEqual({});
  });

  it('rejects empty text', () => {
    expect(InboundMessageSchema.safeParse({ channel: 'web', text: '   ' }).success).toBe(false);
  });
});

describe('DraftReplySchema', () => {
  it('requires positive integer source ids', () => {
    expect(DraftReplySchema.safeParse({ reply: 'ok', sourceIds: [0], needsHuman: false }).success).toBe(false);
    expect(DraftReplySchema.safeParse({ reply: 'ok', sourceIds: [1, 2], needsHuman: false }).success).toBe(true);
  });
});
