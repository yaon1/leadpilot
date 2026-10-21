import { createApiKey } from '../auth.js';
import { loadConfig } from '../config.js';
import { createEmbeddingProvider } from '../llm/index.js';
import { createPool } from '../db/pool.js';
import { KnowledgeBase } from '../rag/kb.js';
import { DEMO_KB } from '../seed-data.js';

/** Idempotent demo seed: tenant "demo", API keys from env, demo knowledge base. */
const cfg = loadConfig();
const db = createPool(cfg.DATABASE_URL);
try {
  const tenant = await db.query<{ id: string }>(
    `INSERT INTO tenants (slug, name) VALUES ('demo', 'Demo Integrator') ON CONFLICT (slug) DO UPDATE SET name = EXCLUDED.name RETURNING id`,
  );
  const tenantId = tenant.rows[0]!.id;

  const keys: [string | undefined, 'admin' | 'operator' | 'agent'][] = [
    [cfg.DEMO_ADMIN_KEY, 'admin'],
    [cfg.DEMO_OPERATOR_KEY, 'operator'],
    [cfg.DEMO_AGENT_KEY, 'agent'],
  ];
  for (const [key, role] of keys) {
    if (key) await createApiKey(db, tenantId, `demo-${role}`, role, key);
    else console.log(`${role} key: ${await createApiKey(db, tenantId, `demo-${role}`, role)} (shown once)`);
  }

  const existing = await db.query('SELECT 1 FROM kb_documents WHERE tenant_id = $1 LIMIT 1', [tenantId]);
  if (existing.rowCount === 0) {
    const kb = new KnowledgeBase(db, createEmbeddingProvider(cfg));
    for (const doc of DEMO_KB) await kb.addDocument(tenantId, doc.title, doc.content);
    console.log(`seeded ${DEMO_KB.length} knowledge base documents`);
  }
  console.log('seed done');
} finally {
  await db.end();
}
