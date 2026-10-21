import { createHash, randomBytes } from 'node:crypto';
import type { Role } from '@leadpilot/shared';
import type { FastifyRequest } from 'fastify';
import type { Db } from './db/pool.js';
import { HttpError } from './errors.js';

export type Permission = 'ingest' | 'tickets:read' | 'tickets:review' | 'kb:read' | 'kb:write' | 'crm:read' | 'crm:write' | 'stats:read';

/** Role -> permissions. The `agent` role is what an MCP client/LLM agent gets: it can read and act, but not approve. */
export const ROLE_PERMISSIONS: Record<Role, ReadonlySet<Permission>> = {
  admin: new Set(['ingest', 'tickets:read', 'tickets:review', 'kb:read', 'kb:write', 'crm:read', 'crm:write', 'stats:read']),
  operator: new Set(['ingest', 'tickets:read', 'tickets:review', 'kb:read', 'crm:read', 'crm:write', 'stats:read']),
  agent: new Set(['ingest', 'tickets:read', 'kb:read', 'crm:read', 'crm:write']),
};

export interface Principal {
  keyId: string;
  tenantId: string;
  tenantSlug: string;
  role: Role;
  name: string;
}

declare module 'fastify' {
  interface FastifyRequest {
    principal?: Principal;
  }
}

export const hashKey = (key: string) => createHash('sha256').update(key).digest('hex');

export function generateApiKey(): string {
  return `lp_${randomBytes(24).toString('base64url')}`;
}

export async function createApiKey(db: Db, tenantId: string, name: string, role: Role, plaintext = generateApiKey()): Promise<string> {
  await db.query(
    `INSERT INTO api_keys (tenant_id, name, role, key_hash, key_prefix) VALUES ($1, $2, $3, $4, $5)
     ON CONFLICT (key_hash) DO NOTHING`,
    [tenantId, name, role, hashKey(plaintext), plaintext.slice(0, 7)],
  );
  return plaintext;
}

export async function authenticate(db: Db, req: FastifyRequest): Promise<Principal> {
  const header = req.headers.authorization;
  const token = header?.startsWith('Bearer ') ? header.slice(7).trim() : undefined;
  if (!token) throw new HttpError(401, 'missing bearer token', 'unauthorized');
  const res = await db.query<{ id: string; tenant_id: string; slug: string; role: Role; name: string }>(
    `SELECT k.id, k.tenant_id, t.slug, k.role, k.name FROM api_keys k JOIN tenants t ON t.id = k.tenant_id
      WHERE k.key_hash = $1 AND k.revoked_at IS NULL`,
    [hashKey(token)],
  );
  const row = res.rows[0];
  if (!row) throw new HttpError(401, 'invalid api key', 'unauthorized');
  return { keyId: row.id, tenantId: row.tenant_id, tenantSlug: row.slug, role: row.role, name: row.name };
}

export function authorize(principal: Principal | undefined, permission: Permission): Principal {
  if (!principal) throw new HttpError(401, 'unauthenticated', 'unauthorized');
  if (!ROLE_PERMISSIONS[principal.role].has(permission)) {
    throw new HttpError(403, `role '${principal.role}' lacks permission '${permission}'`, 'forbidden');
  }
  return principal;
}
