import { Counter, Histogram, Registry, collectDefaultMetrics } from 'prom-client';

export const registry = new Registry();
collectDefaultMetrics({ register: registry, prefix: 'leadpilot_' });

export const inboundTotal = new Counter({
  name: 'leadpilot_inbound_total',
  help: 'Inbound messages by channel and outcome (accepted, replayed, conflict, rejected)',
  labelNames: ['channel', 'outcome'] as const,
  registers: [registry],
});

export const llmRequestsTotal = new Counter({
  name: 'leadpilot_llm_requests_total',
  help: 'LLM calls by provider, task and outcome (ok, invalid, error)',
  labelNames: ['provider', 'task', 'outcome'] as const,
  registers: [registry],
});

export const llmDuration = new Histogram({
  name: 'leadpilot_llm_request_duration_seconds',
  help: 'LLM call latency',
  labelNames: ['provider', 'task'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30],
  registers: [registry],
});

export const llmAttempts = new Histogram({
  name: 'leadpilot_llm_attempts',
  help: 'Attempts needed to get a schema-valid LLM answer',
  labelNames: ['task'] as const,
  buckets: [1, 2, 3, 4, 5],
  registers: [registry],
});

export const ticketTransitions = new Counter({
  name: 'leadpilot_ticket_transitions_total',
  help: 'Ticket status transitions',
  labelNames: ['status'] as const,
  registers: [registry],
});

export const pipelineDuration = new Histogram({
  name: 'leadpilot_pipeline_duration_seconds',
  help: 'Duration of background jobs',
  labelNames: ['job', 'outcome'] as const,
  buckets: [0.05, 0.1, 0.25, 0.5, 1, 2, 5, 10, 30, 60],
  registers: [registry],
});

export const crmRequestsTotal = new Counter({
  name: 'leadpilot_crm_requests_total',
  help: 'CRM adapter calls',
  labelNames: ['adapter', 'operation', 'outcome'] as const,
  registers: [registry],
});
