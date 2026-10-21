import { z } from 'zod';
import type { FetchLike } from '../crm/types.js';

/** Subset of the Telegram Update object we care about. */
export const TelegramUpdateSchema = z.object({
  update_id: z.number().int(),
  message: z
    .object({
      message_id: z.number().int(),
      text: z.string().optional(),
      caption: z.string().optional(),
      chat: z.object({ id: z.number().int() }),
      from: z.object({ first_name: z.string().optional(), last_name: z.string().optional(), username: z.string().optional() }).optional(),
      contact: z.object({ phone_number: z.string() }).optional(),
    })
    .optional(),
});
export type TelegramUpdate = z.infer<typeof TelegramUpdateSchema>;

export interface ReplySender {
  sendTelegram(chatId: string, text: string): Promise<void>;
}

export class TelegramSender implements ReplySender {
  constructor(
    private readonly botToken: string | undefined,
    private readonly fetchFn: FetchLike = fetch,
  ) {}

  async sendTelegram(chatId: string, text: string): Promise<void> {
    if (!this.botToken) return; // not configured: reply stays in the dashboard/CRM only
    const res = await this.fetchFn(`https://api.telegram.org/bot${this.botToken}/sendMessage`, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({ chat_id: chatId, text }),
    });
    if (!res.ok) throw new Error(`telegram sendMessage: HTTP ${res.status}`);
  }
}
