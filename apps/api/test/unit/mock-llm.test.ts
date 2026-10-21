import { describe, expect, it } from 'vitest';
import { generateStructured } from '../../src/llm/structured.js';
import { MockLlmProvider, mockExtract, parseBudget } from '../../src/llm/mock.js';
import { ExtractionSchema } from '@leadpilot/shared';

describe('mockExtract', () => {
  it('extracts a sales lead with contacts and budget', () => {
    const x = mockExtract('Здравствуйте! Меня зовут Анна, нужна интеграция сайта с Битрикс24, бюджет 150к. Телефон 8 (912) 345-67-89, anna@shop.ru');
    expect(x).toMatchObject({
      intent: 'new_lead',
      customerName: 'Анна',
      phone: '+79123456789',
      email: 'anna@shop.ru',
      product: 'Интеграция с Битрикс24',
      budgetRub: 150000,
    });
    expect(x.summary).toBe('Нужна интеграция сайта с Битрикс24, бюджет 150к.');
    expect(ExtractionSchema.safeParse(x).success).toBe(true);
  });

  it('classifies spam, complaints and support', () => {
    expect(mockExtract('Предлагаем услуги SEO продвижения вашего сайта, бесплатный аудит').intent).toBe('spam');
    expect(mockExtract('Это безобразие, верните деньги за проект!').intent).toBe('complaint');
    expect(mockExtract('Заявки перестали приходить в CRM, срочно помогите').intent).toBe('support');
    expect(mockExtract('Заявки перестали приходить в CRM, срочно помогите').urgency).toBe('high');
  });

  it('falls back to channel contact name', () => {
    expect(mockExtract('Добрый день, сколько стоит бот?', 'Олег').customerName).toBe('Олег');
  });
});

describe('parseBudget', () => {
  it.each([
    ['бюджет 150 000 руб', 150000],
    ['до 2 млн', 2000000],
    ['около 80к', 80000],
    ['сделать до 5 дней', null],
    ['без бюджета', null],
  ])('%s -> %s', (text, expected) => {
    expect(parseBudget(text)).toBe(expected);
  });
});

describe('MockLlmProvider', () => {
  it('can simulate an invalid first answer that is fixed on retry', async () => {
    const llm = new MockLlmProvider({ invalidFirstAttempt: true });
    const r = await generateStructured(llm, {
      task: 'extract',
      system: '',
      prompt: 'p',
      schema: ExtractionSchema,
      schemaName: 'Extraction',
      context: { message: 'Хочу заказать лендинг' },
    });
    expect(r.attempts).toBe(2);
    expect(r.value.intent).toBe('new_lead');
  });

  it('drafts a reply citing the top source, or asks for a human without sources', async () => {
    const llm = new MockLlmProvider();
    const withSources = JSON.parse(
      (
        await llm.complete({
          task: 'draft',
          system: '',
          messages: [{ role: 'user', content: '' }],
          schema: ExtractionSchema,
          schemaName: 'DraftReply',
          context: { message: 'Сколько стоит?', contactName: 'Анна', sources: [{ id: 1, title: 't', content: 'Цена от 35 000 рублей. Срок 5 дней.', score: 0.8 }] },
        })
      ).text,
    );
    expect(withSources).toMatchObject({ sourceIds: [1], needsHuman: false });
    expect(withSources.reply).toContain('Анна');
    expect(withSources.reply).toContain('35 000');

    const without = JSON.parse(
      (await llm.complete({ task: 'draft', system: '', messages: [], schema: ExtractionSchema, schemaName: 'DraftReply', context: { message: 'x', sources: [] } })).text,
    );
    expect(without).toMatchObject({ sourceIds: [], needsHuman: true });
  });
});
