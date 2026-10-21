#!/usr/bin/env node
import { StdioServerTransport } from '@modelcontextprotocol/sdk/server/stdio.js';
import { LeadpilotClient } from './client.js';
import { createServer } from './server.js';

const baseUrl = process.env.LEADPILOT_API_URL ?? 'http://localhost:3000';
const apiKey = process.env.LEADPILOT_API_KEY;
if (!apiKey) {
  console.error('LEADPILOT_API_KEY is required (use a key with the "agent" role)');
  process.exit(1);
}

const server = createServer(new LeadpilotClient(baseUrl, apiKey));
await server.connect(new StdioServerTransport());
console.error(`leadpilot MCP server connected to ${baseUrl}`);
