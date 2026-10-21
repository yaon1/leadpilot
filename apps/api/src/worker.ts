import { createServer } from 'node:http';
import { TelegramSender } from './channels/telegram.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';
import { registry } from './metrics.js';
import { startWorker } from './worker-runtime.js';

const cfg = loadConfig();
const c = createContainer(cfg);
const log = {
  info: (obj: object, msg?: string) => console.log(JSON.stringify({ level: 'info', ...obj, msg })),
  error: (obj: object, msg?: string) => console.error(JSON.stringify({ level: 'error', ...obj, msg })),
};

const worker = startWorker(
  {
    tickets: c.tickets,
    llm: c.llm,
    kb: c.kb,
    crm: c.crm,
    sender: new TelegramSender(cfg.TELEGRAM_BOT_TOKEN),
    settings: {
      maxAttempts: cfg.LLM_MAX_ATTEMPTS,
      ragTopK: cfg.RAG_TOP_K,
      ragMinScore: cfg.RAG_MIN_SCORE,
      autoRejectSpamConfidence: cfg.AUTO_REJECT_SPAM_CONFIDENCE,
    },
  },
  c.connection,
  cfg.WORKER_CONCURRENCY,
  log,
);

// Housekeeping: drop expired idempotency receipts.
const purge = setInterval(() => {
  c.idempotency.purgeExpired().then(
    (n) => n && log.info({ purged: n }, 'idempotency receipts purged'),
    (err: Error) => log.error({ err: err.message }, 'purge failed'),
  );
}, 15 * 60_000);

// Prometheus endpoint for the worker process.
const metricsServer = createServer((req, res) => {
  if (req.url === '/metrics') {
    registry.metrics().then((body) => res.writeHead(200, { 'content-type': registry.contentType }).end(body));
  } else if (req.url === '/healthz') {
    res.writeHead(worker.isRunning() ? 200 : 503).end(worker.isRunning() ? 'ok' : 'not running');
  } else res.writeHead(404).end();
}).listen(cfg.WORKER_METRICS_PORT);

log.info({ llm: c.llm.name, crm: c.crm.name, concurrency: cfg.WORKER_CONCURRENCY }, 'leadpilot worker started');

const shutdown = async () => {
  clearInterval(purge);
  metricsServer.close();
  await worker.close();
  await c.queue.close();
  c.redis.disconnect();
  await c.db.end();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown());
process.once('SIGTERM', () => void shutdown());
