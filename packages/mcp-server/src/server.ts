import { createHash } from 'node:crypto';
import { McpServer } from '@modelcontextprotocol/sdk/server/mcp.js';
import { TicketStatusSchema } from '@leadpilot/shared';
import { z } from 'zod';
import { LeadpilotApiError, type LeadpilotClient } from './client.js';

type ToolResult = { content: { type: 'text'; text: string }[]; isError?: boolean };

const ok = (data: unknown): ToolResult => ({ content: [{ type: 'text', text: JSON.stringify(data, null, 2) }] });

async function run(fn: () => Promise<unknown>): Promise<ToolResult> {
  try {
    return ok(await fn());
  } catch (err) {
    // Tool errors are returned to the model (isError) instead of crashing the session.
    const text = err instanceof LeadpilotApiError ? `LeadPilot API error ${err.message}` : (err as Error).message;
    return { content: [{ type: 'text', text }], isError: true };
  }
}

/**
 * MCP server exposing LeadPilot to Claude Desktop / Claude Code / any MCP client.
 * It runs with an `agent` API key: it can read tickets, search CRM and the knowledge
 * base, create follow-up tasks and submit messages, but cannot approve replies —
 * approval stays with a human operator.
 */
export function createServer(client: LeadpilotClient): McpServer {
  const server = new McpServer({ name: 'leadpilot', version: '0.1.0' });

  server.registerTool(
    'list_tickets',
    {
      title: 'List tickets',
      description: 'List recent inbound customer messages (tickets) with their AI classification and status. Use status=awaiting_review to see what operators need to check.',
      inputSchema: { status: TicketStatusSchema.optional(), limit: z.number().int().min(1).max(50).default(10) },
      annotations: { readOnlyHint: true },
    },
    async ({ status, limit }) =>
      run(async () => {
        const { items } = await client.listTickets({ status, limit });
        return items.map((t) => ({
          id: t.id,
          status: t.status,
          channel: t.channel,
          intent: t.extraction?.intent ?? null,
          urgency: t.extraction?.urgency ?? null,
          summary: t.extraction?.summary ?? t.text.slice(0, 120),
          crmDealId: t.crmDealId,
          createdAt: t.createdAt,
        }));
      }),
  );

  server.registerTool(
    'get_ticket',
    {
      title: 'Get ticket',
      description: 'Full ticket: original message, extracted fields, AI draft reply with knowledge base sources, and audit events.',
      inputSchema: { id: z.uuid() },
      annotations: { readOnlyHint: true },
    },
    async ({ id }) => run(() => client.getTicket(id)),
  );

  server.registerTool(
    'search_deals',
    {
      title: 'Search CRM deals',
      description: 'Search deals in the connected CRM (Bitrix24, amoCRM or the built-in mock) by title, contact name, phone or email.',
      inputSchema: { query: z.string().max(200).default(''), limit: z.number().int().min(1).max(50).default(10) },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => run(() => client.searchDeals(query, limit)),
  );

  server.registerTool(
    'search_knowledge_base',
    {
      title: 'Search knowledge base',
      description: 'Semantic search over the company knowledge base (prices, terms, support policies). Returns the most relevant chunks with scores.',
      inputSchema: { query: z.string().min(1).max(1000), limit: z.number().int().min(1).max(10).default(5) },
      annotations: { readOnlyHint: true },
    },
    async ({ query, limit }) => run(() => client.searchKnowledgeBase(query, limit)),
  );

  server.registerTool(
    'create_crm_task',
    {
      title: 'Create CRM task',
      description: 'Create a follow-up task (call back, send proposal, ...) linked to a CRM deal.',
      inputSchema: {
        dealId: z.string().min(1),
        title: z.string().min(1).max(500),
        dueAt: z.iso.datetime().optional().describe('ISO 8601, e.g. 2026-11-01T10:00:00Z'),
      },
      annotations: { readOnlyHint: false, idempotentHint: false },
    },
    async (input) => run(() => client.createTask(input)),
  );

  server.registerTool(
    'submit_message',
    {
      title: 'Submit customer message',
      description:
        'Register a customer request that arrived outside the connected channels (e.g. a phone call summary). It goes through the same AI pipeline and human review. Repeating the same call does not create a duplicate.',
      inputSchema: {
        text: z.string().min(1).max(8000),
        contactName: z.string().max(200).optional(),
        phone: z.string().max(50).optional(),
        email: z.email().optional(),
      },
      annotations: { readOnlyHint: false, idempotentHint: true },
    },
    async ({ text, contactName, phone, email }) =>
      run(() => {
        const contact = Object.fromEntries(Object.entries({ name: contactName, phone, email }).filter(([, v]) => v)) as Record<string, string>;
        // Deterministic key: an agent retrying the same tool call gets the same ticket.
        const key = `mcp-${createHash('sha256').update(JSON.stringify({ text, contact })).digest('hex').slice(0, 32)}`;
        return client.submitMessage({ channel: 'api', text, contact }, key);
      }),
  );

  return server;
}
