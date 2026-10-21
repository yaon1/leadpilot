import { z } from 'zod';

// ---------------------------------------------------------------------------
// Enums
// ---------------------------------------------------------------------------

export const ChannelSchema = z.enum(['telegram', 'web', 'email', 'api']);
export type Channel = z.infer<typeof ChannelSchema>;

export const IntentSchema = z.enum(['new_lead', 'support', 'complaint', 'spam', 'other']);
export type Intent = z.infer<typeof IntentSchema>;

export const UrgencySchema = z.enum(['low', 'normal', 'high']);
export type Urgency = z.infer<typeof UrgencySchema>;

export const TicketStatusSchema = z.enum([
  'received', // stored, waiting for the AI pipeline
  'awaiting_review', // extraction + draft ready, needs a human
  'approved', // operator approved, CRM sync queued
  'synced', // deal/contact written to CRM
  'rejected', // operator rejected (spam, duplicate, ...)
  'failed', // pipeline exhausted its retries
]);
export type TicketStatus = z.infer<typeof TicketStatusSchema>;

export const RoleSchema = z.enum(['admin', 'operator', 'agent']);
export type Role = z.infer<typeof RoleSchema>;

// ---------------------------------------------------------------------------
// Inbound messages (Telegram, web form, email, raw API)
// ---------------------------------------------------------------------------

export const ContactSchema = z.object({
  name: z.string().trim().max(200).optional(),
  phone: z.string().trim().max(50).optional(),
  email: z.email().optional(),
  telegramChatId: z.string().max(64).optional(),
});
export type Contact = z.infer<typeof ContactSchema>;

export const InboundMessageSchema = z.object({
  channel: ChannelSchema,
  /** Id of the message in the source system (Telegram update_id, email Message-ID, ...). */
  externalId: z.string().min(1).max(200).optional(),
  text: z.string().trim().min(1).max(8000),
  contact: ContactSchema.default({}),
});
export type InboundMessage = z.infer<typeof InboundMessageSchema>;

// ---------------------------------------------------------------------------
// LLM outputs. These are the contracts the model must satisfy; anything that
// fails validation is sent back to the model with the error list.
// ---------------------------------------------------------------------------

export const ExtractionSchema = z.object({
  intent: IntentSchema.describe('What the customer wants'),
  confidence: z.number().min(0).max(1).describe('Confidence in the intent, 0..1'),
  summary: z.string().min(1).max(500).describe('One-sentence summary for the operator, in the language of the message'),
  customerName: z.string().min(1).max(200).nullable(),
  phone: z
    .string()
    .regex(/^\+\d{10,15}$/, 'phone must be in E.164 format, e.g. +79991234567')
    .nullable(),
  email: z.email().nullable(),
  product: z.string().min(1).max(200).nullable().describe('Product or service the customer asks about'),
  budgetRub: z.number().int().nonnegative().nullable().describe('Budget in rubles if mentioned'),
  urgency: UrgencySchema,
});
export type Extraction = z.infer<typeof ExtractionSchema>;

export const DraftReplySchema = z.object({
  reply: z.string().min(1).max(2000).describe('Reply to the customer, in the language of the message'),
  sourceIds: z.array(z.number().int().positive()).describe('Numbers of the knowledge base sources the reply relies on'),
  needsHuman: z.boolean().describe('true if the knowledge base does not cover the question'),
});
export type DraftReply = z.infer<typeof DraftReplySchema>;

// ---------------------------------------------------------------------------
// API DTOs
// ---------------------------------------------------------------------------

export const KbSourceSchema = z.object({
  id: z.number().int(),
  chunkId: z.string(),
  title: z.string(),
  content: z.string(),
  score: z.number(),
});
export type KbSource = z.infer<typeof KbSourceSchema>;

export const TicketSchema = z.object({
  id: z.string(),
  channel: ChannelSchema,
  externalId: z.string().nullable(),
  text: z.string(),
  contact: ContactSchema,
  status: TicketStatusSchema,
  extraction: ExtractionSchema.nullable(),
  draft: DraftReplySchema.nullable(),
  sources: z.array(KbSourceSchema),
  finalReply: z.string().nullable(),
  crmDealId: z.string().nullable(),
  error: z.string().nullable(),
  llmAttempts: z.number().int(),
  createdAt: z.string(),
  updatedAt: z.string(),
});
export type Ticket = z.infer<typeof TicketSchema>;

export const ApproveTicketSchema = z.object({
  /** Operator-edited reply; defaults to the AI draft. */
  reply: z.string().trim().min(1).max(4000).optional(),
  /** Operator corrections to extracted fields. */
  extraction: ExtractionSchema.partial().optional(),
});
export type ApproveTicket = z.infer<typeof ApproveTicketSchema>;

export const RejectTicketSchema = z.object({
  reason: z.string().trim().min(1).max(500),
});

export const KbDocumentInputSchema = z.object({
  title: z.string().trim().min(1).max(200),
  content: z.string().trim().min(1).max(200_000),
});
export type KbDocumentInput = z.infer<typeof KbDocumentInputSchema>;

export const CrmDealSchema = z.object({
  id: z.string(),
  title: z.string(),
  stage: z.string(),
  amountRub: z.number().nullable(),
  contactName: z.string().nullable(),
  phone: z.string().nullable(),
  email: z.string().nullable(),
  createdAt: z.string(),
});
export type CrmDeal = z.infer<typeof CrmDealSchema>;

export const CrmTaskInputSchema = z.object({
  dealId: z.string().min(1),
  title: z.string().trim().min(1).max(500),
  dueAt: z.iso.datetime().optional(),
});
export type CrmTaskInput = z.infer<typeof CrmTaskInputSchema>;

export const StatsSchema = z.object({
  byStatus: z.record(z.string(), z.number()),
  byIntent: z.record(z.string(), z.number()),
  last24h: z.number(),
  avgLlmAttempts: z.number(),
});
export type Stats = z.infer<typeof StatsSchema>;
