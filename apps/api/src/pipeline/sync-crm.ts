import type { CrmAdapter } from '../crm/types.js';
import type { ReplySender } from '../channels/telegram.js';
import type { TicketRepository } from '../tickets.js';

export interface SyncDeps {
  tickets: TicketRepository;
  crm: CrmAdapter;
  sender: ReplySender;
}

const INTENT_TITLES: Record<string, string> = {
  new_lead: 'Заявка',
  support: 'Обращение в поддержку',
  complaint: 'Жалоба',
  other: 'Обращение',
  spam: 'Спам',
};

/**
 * approved -> synced. Every external side effect is guarded so a retried job
 * (worker crash, CRM 5xx) never creates a second deal or sends a second reply:
 *  1. deal: look up by our ticket id in the CRM before creating; persist deal id;
 *  2. reply: send only if reply_sent_at is empty, then stamp it;
 *  3. status flip is a compare-and-set on `approved`.
 */
export async function syncTicketToCrm(deps: SyncDeps, ticketId: string): Promise<'synced' | 'skipped'> {
  const ticket = await deps.tickets.get(ticketId);
  if (!ticket || ticket.status !== 'approved') return 'skipped';
  const x = ticket.extraction;

  let dealId = ticket.crmDealId ?? (await deps.crm.findDealByExternalId(ticket.tenantId, ticket.id));
  if (!dealId) {
    const title = `${INTENT_TITLES[x?.intent ?? 'other']}: ${x?.product ?? x?.summary.slice(0, 60) ?? 'без темы'}`;
    dealId = await deps.crm.createDeal(ticket.tenantId, {
      externalId: ticket.id,
      title,
      amountRub: x?.budgetRub ?? null,
      contact: { name: x?.customerName ?? ticket.contact.name ?? null, phone: x?.phone ?? null, email: x?.email ?? null },
      comment: [`Канал: ${ticket.channel}`, `Сообщение клиента:\n${ticket.text}`, x ? `Резюме AI: ${x.summary} (срочность: ${x.urgency})` : '']
        .filter(Boolean)
        .join('\n\n'),
    });
  }
  if (dealId !== ticket.crmDealId) await deps.tickets.setCrmDeal(ticket.id, dealId);

  if (ticket.finalReply && !ticket.replySentAt) {
    if (ticket.channel === 'telegram' && ticket.contact.telegramChatId) {
      await deps.sender.sendTelegram(ticket.contact.telegramChatId, ticket.finalReply);
    }
    await deps.crm.addNote(ticket.tenantId, dealId, `Ответ клиенту (${ticket.channel}):\n${ticket.finalReply}`);
    await deps.tickets.markReplySent(ticket.id);
  }

  await deps.tickets.transition(ticket.id, ['approved'], 'synced', { crm_deal_id: dealId, error: null });
  return 'synced';
}
