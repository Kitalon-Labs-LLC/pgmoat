-- Create roles with fixed test passwords
DO $$
BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgmoat_reader') THEN
    CREATE ROLE pgmoat_reader LOGIN PASSWORD 'pgmoat_reader_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgmoat_owner_like') THEN
    CREATE ROLE pgmoat_owner_like LOGIN PASSWORD 'pgmoat_owner_like_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgmoat_bypass') THEN
    CREATE ROLE pgmoat_bypass LOGIN PASSWORD 'pgmoat_bypass_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE BYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgmoat_writer') THEN
    CREATE ROLE pgmoat_writer LOGIN PASSWORD 'pgmoat_writer_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;

  IF NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'pgmoat_audit') THEN
    CREATE ROLE pgmoat_audit LOGIN PASSWORD 'pgmoat_audit_pw' NOSUPERUSER NOCREATEDB NOCREATEROLE NOBYPASSRLS;
  END IF;
END $$;

-- Schema permissions
GRANT USAGE ON SCHEMA public TO pgmoat_reader, pgmoat_owner_like, pgmoat_bypass, pgmoat_writer;
GRANT USAGE ON SCHEMA pgmoat TO pgmoat_audit;

-- pgmoat_reader: SELECT on exposed tables, column-level grant on tables with hidden columns
REVOKE ALL ON ALL TABLES IN SCHEMA public FROM pgmoat_reader;
GRANT SELECT ON tenants, orders, tickets, events, order_totals TO pgmoat_reader;
GRANT SELECT (id, tenant_id, name, email, role, created_at, updated_at) ON users TO pgmoat_reader;
GRANT SELECT (id, tenant_id, name, email, stripe_customer_id, tier, created_at) ON customers TO pgmoat_reader;
REVOKE ALL ON api_keys, internal_audit FROM pgmoat_reader;

-- pgmoat_owner_like: owns orders table (for PGM-703 doctor check)
ALTER TABLE orders OWNER TO pgmoat_owner_like;
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgmoat_owner_like;

-- pgmoat_bypass: has BYPASSRLS privilege (for PGM-702 doctor check)
GRANT SELECT ON ALL TABLES IN SCHEMA public TO pgmoat_bypass;

-- pgmoat_writer: has INSERT/UPDATE on orders, users, tickets (for PGM-706 doctor check)
GRANT SELECT, INSERT, UPDATE ON orders, users, tickets TO pgmoat_writer;

-- pgmoat_audit: INSERT and SELECT on pgmoat.audit
GRANT SELECT, INSERT ON pgmoat.audit TO pgmoat_audit;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA pgmoat TO pgmoat_audit;
