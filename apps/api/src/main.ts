import { buildApp } from './app.js';
import { loadConfig } from './config.js';
import { createContainer } from './container.js';

const cfg = loadConfig();
const c = createContainer(cfg);
const app = await buildApp(c);

const shutdown = async (signal: string) => {
  app.log.info({ signal }, 'shutting down');
  await app.close();
  await c.queue.close();
  c.redis.disconnect();
  await c.db.end();
  process.exit(0);
};
process.once('SIGINT', () => void shutdown('SIGINT'));
process.once('SIGTERM', () => void shutdown('SIGTERM'));

await app.listen({ port: cfg.PORT, host: cfg.HOST });
app.log.info({ llm: c.llm.name, embeddings: c.embeddings.name, crm: c.crm.name }, 'leadpilot api started');
