import type { Intent, TicketStatus, Urgency } from '@leadpilot/shared';

export const STATUS_LABELS: Record<TicketStatus, string> = {
  received: 'В обработке AI',
  awaiting_review: 'Ждёт проверки',
  approved: 'Одобрено',
  synced: 'В CRM',
  rejected: 'Отклонено',
  failed: 'Ошибка',
};

export const STATUS_CLASSES: Record<TicketStatus, string> = {
  received: 'bg-slate-100 text-slate-700 dark:bg-slate-800 dark:text-slate-300',
  awaiting_review: 'bg-amber-100 text-amber-800 dark:bg-amber-950 dark:text-amber-300',
  approved: 'bg-sky-100 text-sky-800 dark:bg-sky-950 dark:text-sky-300',
  synced: 'bg-emerald-100 text-emerald-800 dark:bg-emerald-950 dark:text-emerald-300',
  rejected: 'bg-slate-200 text-slate-600 dark:bg-slate-800 dark:text-slate-400',
  failed: 'bg-rose-100 text-rose-800 dark:bg-rose-950 dark:text-rose-300',
};

export const INTENT_LABELS: Record<Intent, string> = {
  new_lead: 'Заявка',
  support: 'Поддержка',
  complaint: 'Жалоба',
  spam: 'Спам',
  other: 'Другое',
};

export const URGENCY_LABELS: Record<Urgency, string> = { low: 'низкая', normal: 'обычная', high: 'высокая' };

export function formatRub(value: number | null | undefined): string {
  if (value === null || value === undefined) return '—';
  return new Intl.NumberFormat('ru-RU', { style: 'currency', currency: 'RUB', maximumFractionDigits: 0 }).format(value);
}

export function timeAgo(iso: string, now = Date.now()): string {
  const s = Math.max(0, Math.round((now - new Date(iso).getTime()) / 1000));
  if (s < 60) return `${s} с назад`;
  if (s < 3600) return `${Math.floor(s / 60)} мин назад`;
  if (s < 86400) return `${Math.floor(s / 3600)} ч назад`;
  return new Date(iso).toLocaleDateString('ru-RU');
}
