import { Queue, type ConnectionOptions, type JobsOptions } from 'bullmq';

export const QUEUE_NAME = 'leadpilot';

export type JobName = 'process-ticket' | 'sync-crm';
export interface JobData {
  ticketId: string;
}

export const DEFAULT_JOB_OPTIONS: JobsOptions = {
  attempts: 4,
  backoff: { type: 'exponential', delay: 2000 },
  removeOnComplete: { age: 24 * 3600, count: 1000 },
  removeOnFail: { age: 7 * 24 * 3600 },
};

export function redisConnection(url: string): ConnectionOptions {
  const u = new URL(url);
  return {
    host: u.hostname,
    port: Number(u.port || 6379),
    username: u.username || undefined,
    password: u.password || undefined,
    db: u.pathname.length > 1 ? Number(u.pathname.slice(1)) : 0,
    tls: u.protocol === 'rediss:' ? {} : undefined,
    maxRetriesPerRequest: null,
  };
}

export interface Enqueuer {
  /**
   * Job id is derived from the job name and ticket id, so enqueuing the same work
   * twice is a no-op while the job exists. `run` distinguishes a deliberate re-run.
   */
  enqueue(name: JobName, ticketId: string, run?: string): Promise<void>;
}

export class JobQueue implements Enqueuer {
  readonly queue: Queue<JobData, unknown, JobName>;

  constructor(connection: ConnectionOptions) {
    this.queue = new Queue<JobData, unknown, JobName>(QUEUE_NAME, { connection, defaultJobOptions: DEFAULT_JOB_OPTIONS });
  }

  async enqueue(name: JobName, ticketId: string, run?: string): Promise<void> {
    await this.queue.add(name, { ticketId }, { jobId: run ? `${name}__${ticketId}__${run}` : `${name}__${ticketId}` });
  }

  async close(): Promise<void> {
    await this.queue.close();
  }
}
