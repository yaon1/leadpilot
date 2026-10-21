CREATE EXTENSION IF NOT EXISTS vector;
CREATE EXTENSION IF NOT EXISTS pgcrypto;

CREATE TABLE tenants (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  slug        text NOT NULL UNIQUE,
  name        text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

-- API keys are stored as SHA-256 hashes; the plaintext is shown once.
CREATE TABLE api_keys (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name        text NOT NULL,
  role        text NOT NULL CHECK (role IN ('admin', 'operator', 'agent')),
  key_hash    text NOT NULL UNIQUE,
  key_prefix  text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now(),
  revoked_at  timestamptz
);

-- Receipt journal for idempotent command handling.
CREATE TABLE idempotency_receipts (
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  key            text NOT NULL,
  request_hash   text NOT NULL,
  status         text NOT NULL CHECK (status IN ('processing', 'completed')),
  response_code  integer,
  response_body  jsonb,
  created_at     timestamptz NOT NULL DEFAULT now(),
  completed_at   timestamptz,
  PRIMARY KEY (tenant_id, key)
);
CREATE INDEX idempotency_receipts_created_at_idx ON idempotency_receipts (created_at);

CREATE TABLE tickets (
  id             uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id      uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  channel        text NOT NULL,
  external_id    text,
  text           text NOT NULL,
  contact        jsonb NOT NULL DEFAULT '{}',
  status         text NOT NULL DEFAULT 'received',
  extraction     jsonb,
  draft          jsonb,
  sources        jsonb NOT NULL DEFAULT '[]',
  final_reply    text,
  crm_deal_id    text,
  reply_sent_at  timestamptz,
  error          text,
  llm_attempts   integer NOT NULL DEFAULT 0,
  reviewed_by    uuid REFERENCES api_keys(id),
  created_at     timestamptz NOT NULL DEFAULT now(),
  updated_at     timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, channel, external_id)
);
CREATE INDEX tickets_tenant_status_idx ON tickets (tenant_id, status, created_at DESC);

CREATE TABLE ticket_events (
  id          bigserial PRIMARY KEY,
  ticket_id   uuid NOT NULL REFERENCES tickets(id) ON DELETE CASCADE,
  type        text NOT NULL,
  data        jsonb NOT NULL DEFAULT '{}',
  actor       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX ticket_events_ticket_idx ON ticket_events (ticket_id, id);

CREATE TABLE kb_documents (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  title       text NOT NULL,
  created_at  timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE kb_chunks (
  id           uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id    uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  document_id  uuid NOT NULL REFERENCES kb_documents(id) ON DELETE CASCADE,
  ordinal      integer NOT NULL,
  content      text NOT NULL,
  embedding    vector(256) NOT NULL
);
CREATE INDEX kb_chunks_tenant_idx ON kb_chunks (tenant_id);
CREATE INDEX kb_chunks_embedding_idx ON kb_chunks USING hnsw (embedding vector_cosine_ops);

-- Backing store for the mock CRM adapter (lets the demo run without Bitrix24/amoCRM).
CREATE TABLE mock_crm_deals (
  id            bigserial PRIMARY KEY,
  tenant_id     uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  external_id   text NOT NULL,
  title         text NOT NULL,
  stage         text NOT NULL DEFAULT 'NEW',
  amount_rub    numeric,
  contact_name  text,
  phone         text,
  email         text,
  created_at    timestamptz NOT NULL DEFAULT now(),
  UNIQUE (tenant_id, external_id)
);

CREATE TABLE mock_crm_activities (
  id          bigserial PRIMARY KEY,
  tenant_id   uuid NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  deal_id     bigint NOT NULL REFERENCES mock_crm_deals(id) ON DELETE CASCADE,
  kind        text NOT NULL CHECK (kind IN ('note', 'task')),
  text        text NOT NULL,
  due_at      timestamptz,
  created_at  timestamptz NOT NULL DEFAULT now()
);
