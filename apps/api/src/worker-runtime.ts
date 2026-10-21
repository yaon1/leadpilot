import { UnrecoverableError, Worker, type ConnectionOptions, type Job } from 'bullmq';
import type { ReplySender } from './channels/telegram.js';
import type { CrmAdapter } from './crm/types.js';
import { CrmError } from './crm/types.js';
import { LlmValidationError } from './llm/structured.js';
import type { LlmProvider } from './llm/types.js';
import { pipelineDuration } from './metrics.js';
import { processTicket, type ProcessDeps } from './pipeline/process-ticket.js';
import { syncTicketToCrm } from './pipeline/sync-crm.js';
import { QUEUE_NAME, type JobData, type JobName } from './queue.js';
import type { KnowledgeBase } from './rag/kb.js';
import type { TicketRepository } from './tickets.js';

export interface WorkerDeps {
  tickets: TicketRepository;
  llm: LlmProvider;
  kb: KnowledgeBase;
  crm: CrmAdapter;
  sender: ReplySender;
  settings: Omit<ProcessDeps, 'tickets' | 'llm' | 'kb'>;
}

export interface Logger {
  info(obj: object, msg?: string): void;
  error(obj: object, msg?: string): void;
}

/** Errors that will not get better on retry skip BullMQ's backoff and fail the job immediately. */
function classify(err: unknown): Error {
  if (err instanceof LlmValidationError) return new UnrecoverableError(err.message);
  if (err instanceof CrmError && !err.retryable) return new UnrecoverableError(err.message);
  return err as Error;
}

export function startWorker(deps: WorkerDeps, connection: ConnectionOptions, concurrency: number, log: Logger) {
  const worker = new Worker<JobData, string, JobName>(
    QUEUE_NAME,
    async (job: Job<JobData, string, JobName>) => {
      const stop = pipelineDuration.startTimer({ job: job.name });
      try {
        const result =
          job.name === 'process-ticket'
            ? await processTicket({ ...deps.settings, tickets: deps.tickets, llm: deps.llm, kb: deps.kb }, job.data.ticketId)
            : await syncTicketToCrm({ tickets: deps.tickets, crm: deps.crm, sender: deps.sender }, job.data.ticketId);
        stop({ outcome: result });
        return result;
      } catch (err) {
        stop({ outcome: 'error' });
        throw classify(err);
      }
    },
    { connection, concurrency },
  );

  worker.on('failed', (job, err) => {
    if (!job) return;
    const exhausted = err instanceof UnrecoverableError || job.attemptsMade >= (job.opts.attempts ?? 1);
    log.error({ jobId: job.id, attempt: job.attemptsMade, exhausted, err: err.message }, 'job failed');
    if (exhausted) {
      const from = job.name === 'process-ticket' ? (['received'] as const) : (['approved'] as const);
      void deps.tickets.transition(job.data.ticketId, [...from], 'failed', { error: err.message.slice(0, 1000) }, 'worker').catch(() => {});
    }
  });
  worker.on('completed', (job, result) => log.info({ jobId: job.id, result }, 'job completed'));
  return worker;
}
