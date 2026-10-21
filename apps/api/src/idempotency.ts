import { createHash } from 'node:crypto';
import type { Db } from './db/pool.js';
import { HttpError } from './errors.js';

export interface StoredResponse {
  statusCode: number;
  body: unknown;
}

export type IdempotencyOutcome<T extends StoredResponse> = { replayed: false; response: T } | { replayed: true; response: StoredResponse };

/** Stable hash of a JSON payload (key order independent). */
export function requestHash(payload: unknown): string {
  const canonical = (v: unknown): unknown =>
    Array.isArray(v)
      ? v.map(canonical)
      : v && typeof v === 'object'
        ? Object.fromEntries(
            Object.entries(v as Record<string, unknown>)
              .filter(([, x]) => x !== undefined)
              .sort(([a], [b]) => a.localeCompare(b))
              .map(([k, x]) => [k, canonical(x)]),
          )
        : v;
  return createHash('sha256').update(JSON.stringify(canonical(payload))).digest('hex');
}

/**
 * Receipt journal for idempotent commands (Stripe-style Idempotency-Key):
 *  - first request with a key claims a `processing` receipt, runs the handler and stores its response;
 *  - a repeat with the same key and same payload gets the stored response replayed;
 *  - same key + different payload -> 422; same key while the first is still running -> 409.
 * If the handler throws, the receipt is released so the client can retry.
 */
export class IdempotencyStore {
  constructor(
    private readonly db: Db,
    private readonly ttlHours: number,
  ) {}

  async run<T extends StoredResponse>(tenantId: string, key: string, payload: unknown, handler: () => Promise<T>): Promise<IdempotencyOutcome<T>> {
    const hash = requestHash(payload);
    const claimed = await this.db.query(
      `INSERT INTO idempotency_receipts (tenant_id, key, request_hash, status) VALUES ($1, $2, $3, 'processing')
       ON CONFLICT (tenant_id, key) DO UPDATE
         SET request_hash = EXCLUDED.request_hash, status = 'processing', response_code = NULL, response_body = NULL,
             created_at = now(), completed_at = NULL
         WHERE idempotency_receipts.created_at < now() - make_interval(hours => $4)
       RETURNING key`,
      [tenantId, key, hash, this.ttlHours],
    );

    if (claimed.rowCount === 0) {
      const existing = await this.db.query<{ request_hash: string; status: string; response_code: number; response_body: unknown }>(
        'SELECT request_hash, status, response_code, response_body FROM idempotency_receipts WHERE tenant_id = $1 AND key = $2',
        [tenantId, key],
      );
      const row = existing.rows[0];
      if (!row) return this.run(tenantId, key, payload, handler); // expired & deleted concurrently: try again
      if (row.request_hash !== hash) {
        throw new HttpError(422, 'Idempotency-Key was already used with a different payload', 'idempotency_key_reused');
      }
      if (row.status === 'processing') {
        throw new HttpError(409, 'A request with this Idempotency-Key is still being processed', 'idempotency_in_progress', { 'retry-after': '1' });
      }
      return { replayed: true, response: { statusCode: row.response_code, body: row.response_body } };
    }

    try {
      const response = await handler();
      await this.db.query(
        `UPDATE idempotency_receipts SET status = 'completed', response_code = $3, response_body = $4, completed_at = now()
          WHERE tenant_id = $1 AND key = $2`,
        [tenantId, key, response.statusCode, JSON.stringify(response.body)],
      );
      return { replayed: false, response };
    } catch (err) {
      await this.db.query('DELETE FROM idempotency_receipts WHERE tenant_id = $1 AND key = $2', [tenantId, key]);
      throw err;
    }
  }

  async purgeExpired(): Promise<number> {
    const res = await this.db.query('DELETE FROM idempotency_receipts WHERE created_at < now() - make_interval(hours => $1)', [this.ttlHours]);
    return res.rowCount ?? 0;
  }
}
