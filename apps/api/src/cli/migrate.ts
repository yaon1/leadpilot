import { loadConfig } from '../config.js';
import { createPool } from '../db/pool.js';
import { migrate } from '../db/migrate.js';

const db = createPool(loadConfig().DATABASE_URL);
try {
  const applied = await migrate(db, (m) => console.log(m));
  console.log(applied.length ? `done (${applied.length} applied)` : 'schema is up to date');
} finally {
  await db.end();
}
