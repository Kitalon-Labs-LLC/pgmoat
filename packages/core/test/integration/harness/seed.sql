-- Schema creation
CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
CREATE EXTENSION IF NOT EXISTS "pgcrypto";

CREATE TABLE IF NOT EXISTS tenants (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  name TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS users (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'member',
  password_hash TEXT NOT NULL,
  mfa_secret TEXT,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now(),
  updated_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS orders (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  amount NUMERIC(10, 2) NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS tickets (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS customers (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  name TEXT NOT NULL,
  email TEXT NOT NULL,
  stripe_customer_id TEXT,
  tier TEXT NOT NULL DEFAULT 'standard',
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS api_keys (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID NOT NULL REFERENCES tenants(id) ON DELETE CASCADE,
  token_hash TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS internal_audit (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS events (
  id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
  tenant_id UUID REFERENCES tenants(id) ON DELETE CASCADE,
  event_type TEXT NOT NULL,
  payload JSONB NOT NULL DEFAULT '{}'::jsonb,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- Schema pgmoat and audit table for pgmoat_audit role
CREATE SCHEMA IF NOT EXISTS pgmoat;

CREATE TABLE IF NOT EXISTS pgmoat.audit (
  id BIGSERIAL PRIMARY KEY,
  event TEXT NOT NULL,
  created_at TIMESTAMPTZ NOT NULL DEFAULT now()
);

-- View order_totals
CREATE OR REPLACE VIEW order_totals AS
SELECT
  tenant_id,
  count(*) AS order_count,
  sum(amount) AS total_amount
FROM orders
GROUP BY tenant_id;

-- Comments
COMMENT ON TABLE users IS 'User accounts table';
COMMENT ON COLUMN users.email IS 'User primary email address';
COMMENT ON COLUMN users.password_hash IS 'Bcrypt password hash';
COMMENT ON TABLE orders IS 'Customer orders table';
COMMENT ON TABLE tickets IS 'Support tickets table';

-- Seed initial data
TRUNCATE TABLE tickets, orders, users, customers, api_keys, internal_audit, events, tenants CASCADE;

-- Tenant A & B
INSERT INTO tenants (id, name, created_at) VALUES
  ('a0000000-0000-0000-0000-000000000001', 'Tenant A', '2026-01-01 00:00:00Z'),
  ('b0000000-0000-0000-0000-000000000002', 'Tenant B', '2026-01-01 00:00:00Z');

-- Users
INSERT INTO users (id, tenant_id, name, email, role, password_hash, mfa_secret, created_at) VALUES
  ('a1000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Alice Admin', 'alice@tenant-a.com', 'admin', '$2a$12$hashedpwd_alice', 'mfa_secret_alice_123', '2026-01-02 10:00:00Z'),
  ('a1000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'Arthur User', 'arthur@tenant-a.com', 'member', '$2a$12$hashedpwd_arthur', NULL, '2026-01-02 11:00:00Z'),
  ('b1000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Bob Admin', 'bob@tenant-b.com', 'admin', '$2a$12$hashedpwd_bob', 'mfa_secret_bob_456', '2026-01-02 10:00:00Z');

-- Orders
INSERT INTO orders (id, tenant_id, user_id, amount, status, created_at) VALUES
  ('a2000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 99.99, 'completed', '2026-01-03 12:00:00Z'),
  ('a2000000-0000-0000-0000-000000000002', 'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000002', 149.50, 'pending', '2026-01-03 14:00:00Z'),
  ('b2000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 499.00, 'completed', '2026-01-03 13:00:00Z');

-- Tickets
INSERT INTO tickets (id, tenant_id, user_id, title, body, status, created_at) VALUES
  ('a3000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'a1000000-0000-0000-0000-000000000001', 'Need refund', 'Please process refund for order a2000000...', 'open', '2026-01-04 09:00:00Z'),
  ('b3000000-0000-0000-0000-000000000002', 'b0000000-0000-0000-0000-000000000002', 'b1000000-0000-0000-0000-000000000001', 'Upgrade request', 'Looking to upgrade to enterprise tier', 'closed', '2026-01-04 10:00:00Z');

-- Customers
INSERT INTO customers (id, tenant_id, name, email, stripe_customer_id, tier, created_at) VALUES
  ('a4000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'Acme Corp', 'billing@acme.corp', 'cus_A123456789', 'enterprise', '2026-01-01 00:00:00Z'),
  ('b4000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'Beta LLC', 'billing@beta.llc', 'cus_B987654321', 'standard', '2026-01-01 00:00:00Z');

-- API Keys
INSERT INTO api_keys (id, tenant_id, token_hash, created_at) VALUES
  ('a5000000-0000-0000-0000-000000000001', 'a0000000-0000-0000-0000-000000000001', 'hash_sec_a_key', '2026-01-01 00:00:00Z'),
  ('b5000000-0000-0000-0000-000000000001', 'b0000000-0000-0000-0000-000000000002', 'hash_sec_b_key', '2026-01-01 00:00:00Z');

-- Internal Audit
INSERT INTO internal_audit (id, event_type, payload, created_at) VALUES
  ('90000000-0000-0000-0000-000000000001', 'cluster_init', '{"node": "primary", "version": 17}'::jsonb, '2026-01-01 00:00:00Z');
