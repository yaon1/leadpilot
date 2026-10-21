import type { CrmDeal, CrmTaskInput } from '@leadpilot/shared';

export interface NewDeal {
  /** Our ticket id. Stored in the CRM so a retried sync finds the deal instead of duplicating it. */
  externalId: string;
  title: string;
  amountRub: number | null;
  contact: { name: string | null; phone: string | null; email: string | null };
  comment: string;
}

export interface CrmAdapter {
  readonly name: string;
  findDealByExternalId(tenantId: string, externalId: string): Promise<string | null>;
  createDeal(tenantId: string, deal: NewDeal): Promise<string>;
  addNote(tenantId: string, dealId: string, text: string): Promise<void>;
  searchDeals(tenantId: string, query: string, limit: number): Promise<CrmDeal[]>;
  createTask(tenantId: string, task: CrmTaskInput): Promise<{ id: string }>;
}

export class CrmError extends Error {
  constructor(
    message: string,
    public readonly retryable: boolean,
  ) {
    super(message);
  }
}

export type FetchLike = (input: string, init?: RequestInit) => Promise<Response>;

/** Maps an HTTP failure to a retryable/non-retryable CrmError. */
export async function ensureOk(res: Response, what: string): Promise<void> {
  if (res.ok) return;
  const body = await res.text().catch(() => '');
  const retryable = res.status === 429 || res.status >= 500;
  throw new CrmError(`${what}: HTTP ${res.status} ${body.slice(0, 300)}`, retryable);
}
