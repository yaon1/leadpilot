import { normalizePhone, type DraftReply, type Extraction, type Intent } from '@leadpilot/shared';
import type { LlmProvider, LlmRequest, LlmResponse } from './types.js';

/**
 * Deterministic rule-based "model" so the demo, CI and the eval harness run
 * without API keys. It is intentionally simple: the eval shows where it fails,
 * which is exactly what you want to compare a real model against.
 */
const INTENT_RULES: [Intent, RegExp][] = [
  ['spam', /казино|ставк[иа]|крипт|заработ(ок|ай)|раскрутк|продвижени[ея] (вашего|сайта)|предлагаем (услуги|сотрудничество)|рассылк|бесплатн(ый|ая) аудит|casino|crypto/i],
  ['complaint', /жалоб|претензи|недовол|ужасн|безобрази|верните (деньги|средства)|возврат (денег|средств)|обман|разочарован|кошмар/i],
  ['support', /не работает|ошибк|не могу|не приходит|сломал|перестал|не открывается|как настроить|помогите|не синхронизир|отвалил|баг|завис/i],
  ['new_lead', /стоимост|сколько стоит|цен[аы]|прайс|купить|заказать|хотим|хочу|интересует|нужн[аоы]?|нужен|коммерческ|расчет|расчёт|подключить|внедрить|внедрение|сделать/i],
];

const PRODUCTS: [string, RegExp][] = [
  ['Интеграция с Битрикс24', /битрикс|bitrix/i],
  ['Интеграция с amoCRM', /amo ?crm|амо ?срм|амо/i],
  ['Telegram-бот', /телеграм|telegram|бот/i],
  ['Интернет-магазин', /интернет-магазин|магазин/i],
  ['Лендинг', /лендинг|landing|посадочн/i],
  ['Сайт', /сайт/i],
  ['AI-ассистент', /ассистент|нейросет|gpt|ai-|ии-/i],
];

const PHONE_RE = /(?:\+7|8|\+\d{1,3})[\s(-]*\d{3}[\s)-]*\d{3}[\s-]*\d{2}[\s-]*\d{2}/;
const EMAIL_RE = /[\w.+-]+@[\w-]+\.[\w.-]+/;
const NAME_RE = /(?:[Мм]еня зовут|[Ээ]то|(?:^|\s)[Яя])\s+([А-ЯЁ][а-яё]+(?:\s+[А-ЯЁ][а-яё]+)?)|(?:^|\n)\s*(?:С уважением,?\s*)?[—-]\s*([А-ЯЁ][а-яё]+)\s*$/m;

export function parseBudget(text: string): number | null {
  const m = /(?:бюджет|до|около|в районе|за)\s*(?:~\s*)?(\d[\d\s]*(?:[.,]\d+)?)\s*(к|k|тыс\.?|тысяч|млн|миллион\w*|₽|руб\w*|р\.?)?/i.exec(text);
  if (!m?.[1]) return null;
  const n = Number(m[1].replace(/\s/g, '').replace(',', '.'));
  if (!Number.isFinite(n)) return null;
  const unit = (m[2] ?? '').toLowerCase();
  if (/^(к|k|тыс)/.test(unit)) return Math.round(n * 1000);
  if (/^(млн|миллион)/.test(unit)) return Math.round(n * 1_000_000);
  if (!unit && n < 1000) return null; // "до 5 дней" is not a budget
  return Math.round(n);
}

/** More keyword hits for the winning intent -> higher confidence; competing intents lower it. */
function confidenceOf(text: string, matches: [Intent, RegExp][]): number {
  const winner = matches[0];
  if (!winner) return 0.4;
  const hits = text.match(new RegExp(winner[1].source, 'gi'))?.length ?? 1;
  const score = 0.55 + 0.15 * hits - 0.1 * (matches.length - 1);
  return Number(Math.max(0.3, Math.min(0.95, score)).toFixed(2));
}

export function mockExtract(text: string, contactName?: string): Extraction {
  const matches = INTENT_RULES.filter(([, re]) => re.test(text));
  const intent: Intent = matches[0]?.[0] ?? 'other';
  const phone = normalizePhone(PHONE_RE.exec(text)?.[0]);
  const email = EMAIL_RE.exec(text)?.[0] ?? null;
  const nameMatch = NAME_RE.exec(text);
  const customerName = nameMatch?.[1] ?? nameMatch?.[2] ?? contactName ?? null;
  const product = PRODUCTS.find(([, re]) => re.test(text))?.[0] ?? null;
  const urgency = intent === 'spam' ? 'low' : /срочно|сегодня|asap|горит|немедленно|прямо сейчас|не работает/i.test(text) ? 'high' : 'normal';
  // Summary: first sentence that is not just a greeting, without a "Меня зовут X," preamble.
  const sentences = text
    .split(/(?<=[.!?])\s+/)
    .map((x) => x.trim().replace(/^(?:меня зовут|это)\s+[\p{L}-]+[,.!]?\s*/iu, ''))
    .filter((x) => x.length > 0 && !/^(?:здравствуй\p{L}*|добр\p{L}*\s+\p{L}+|привет\p{L}*|hello|hi)[!.,\s]*$/iu.test(x));
  const first = sentences[0] ?? text;
  const firstSentence = (first.charAt(0).toUpperCase() + first.slice(1)).slice(0, 200);
  return {
    intent,
    confidence: confidenceOf(text, matches),
    summary: firstSentence.trim() || 'Сообщение клиента',
    customerName,
    phone,
    email,
    product: intent === 'spam' ? null : product,
    budgetRub: intent === 'new_lead' ? parseBudget(text) : null,
    urgency,
  };
}

export function mockDraft(req: LlmRequest): DraftReply {
  const sources = req.context.sources ?? [];
  const greeting = req.context.contactName ? `Здравствуйте, ${req.context.contactName}!` : 'Здравствуйте!';
  const top = sources[0];
  if (!top) {
    return {
      reply: `${greeting} Спасибо за обращение. Передал ваш вопрос специалисту, он свяжется с вами в ближайшее время.`,
      sourceIds: [],
      needsHuman: true,
    };
  }
  const facts = top.content.split(/(?<=[.!?])\s+/).slice(0, 2).join(' ');
  return {
    reply: `${greeting} Спасибо за обращение. ${facts} Если удобно, менеджер свяжется с вами, чтобы обсудить детали.`,
    sourceIds: [top.id],
    needsHuman: false,
  };
}

export class MockLlmProvider implements LlmProvider {
  readonly name = 'mock';

  constructor(private readonly opts: { invalidFirstAttempt?: boolean } = {}) {}

  async complete(req: LlmRequest): Promise<LlmResponse> {
    const isRetry = req.messages.length > 1;
    if (this.opts.invalidFirstAttempt && !isRetry) {
      // Typical real-world failure: un-normalized phone, wrapped in prose.
      const bad = req.task === 'extract' ? { ...mockExtract(req.context.message, req.context.contactName), phone: '8 (999) 000-00-00' } : { reply: '' };
      return { text: `Sure! Here is the JSON:\n${JSON.stringify(bad)}` };
    }
    const value = req.task === 'extract' ? mockExtract(req.context.message, req.context.contactName) : mockDraft(req);
    return { text: JSON.stringify(value) };
  }
}
