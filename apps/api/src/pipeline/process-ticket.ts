import { DraftReplySchema, ExtractionSchema, normalizePhone, type Extraction } from '@leadpilot/shared';
import type { KnowledgeBase } from '../rag/kb.js';
import { generateStructured } from '../llm/structured.js';
import { DRAFT_SYSTEM, EXTRACT_SYSTEM, draftPrompt, extractPrompt } from '../llm/prompts.js';
import type { LlmProvider } from '../llm/types.js';
import type { TicketRepository } from '../tickets.js';

export interface ProcessDeps {
  tickets: TicketRepository;
  llm: LlmProvider;
  kb: KnowledgeBase;
  maxAttempts: number;
  ragTopK: number;
  ragMinScore: number;
  autoRejectSpamConfidence: number;
}

/**
 * received -> awaiting_review (or rejected for confident spam).
 * Safe to run twice: a ticket that already left `received` is skipped.
 */
export async function processTicket(deps: ProcessDeps, ticketId: string): Promise<'processed' | 'skipped'> {
  const ticket = await deps.tickets.get(ticketId);
  if (!ticket || ticket.status !== 'received') return 'skipped';

  const contactHint = [ticket.contact.name && `name=${ticket.contact.name}`, ticket.contact.phone && `phone=${ticket.contact.phone}`, ticket.contact.email && `email=${ticket.contact.email}`]
    .filter(Boolean)
    .join(', ');

  const extracted = await generateStructured(deps.llm, {
    task: 'extract',
    system: EXTRACT_SYSTEM,
    prompt: extractPrompt(ticket.text, contactHint),
    schema: ExtractionSchema,
    schemaName: 'Extraction',
    context: { message: ticket.text, contactName: ticket.contact.name },
    maxAttempts: deps.maxAttempts,
  });

  // Channel metadata (Telegram profile, form fields) beats nothing, but the text wins if both exist.
  const extraction: Extraction = {
    ...extracted.value,
    customerName: extracted.value.customerName ?? ticket.contact.name ?? null,
    phone: extracted.value.phone ?? normalizePhone(ticket.contact.phone),
    email: extracted.value.email ?? ticket.contact.email ?? null,
  };

  if (extraction.intent === 'spam' && extraction.confidence >= deps.autoRejectSpamConfidence) {
    await deps.tickets.transition(ticketId, ['received'], 'rejected', {
      extraction,
      error: `auto-rejected as spam (confidence ${extraction.confidence})`,
      llm_attempts: extracted.attempts,
    });
    return 'processed';
  }

  const sources = await deps.kb.search(ticket.tenantId, ticket.text, deps.ragTopK, deps.ragMinScore);
  const validIds = new Set(sources.map((s) => s.id));
  const draft = await generateStructured(deps.llm, {
    task: 'draft',
    system: DRAFT_SYSTEM,
    prompt: draftPrompt(ticket.text, extraction, sources),
    schema: DraftReplySchema,
    schemaName: 'DraftReply',
    context: { message: ticket.text, contactName: extraction.customerName ?? undefined, sources },
    maxAttempts: deps.maxAttempts,
    validate: (d) => [
      ...d.sourceIds.filter((id) => !validIds.has(id)).map((id) => `sourceIds: source [${id}] does not exist; valid ids: ${[...validIds].join(', ') || 'none'}`),
      ...(d.sourceIds.length === 0 && !d.needsHuman ? ['needsHuman must be true when no sources are cited'] : []),
    ],
  });

  await deps.tickets.transition(ticketId, ['received'], 'awaiting_review', {
    extraction,
    draft: draft.value,
    sources,
    error: null,
    llm_attempts: extracted.attempts + draft.attempts,
  });
  return 'processed';
}
