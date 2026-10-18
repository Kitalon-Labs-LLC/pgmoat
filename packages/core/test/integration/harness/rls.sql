-- RLS on orders
ALTER TABLE orders ENABLE ROW LEVEL SECURITY;
ALTER TABLE orders FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_orders ON orders;
CREATE POLICY tenant_isolation_orders ON orders
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- RLS on tickets
ALTER TABLE tickets ENABLE ROW LEVEL SECURITY;
ALTER TABLE tickets FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_tickets ON tickets;
CREATE POLICY tenant_isolation_tickets ON tickets
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);

-- RLS on customers
ALTER TABLE customers ENABLE ROW LEVEL SECURITY;
ALTER TABLE customers FORCE ROW LEVEL SECURITY;

DROP POLICY IF EXISTS tenant_isolation_customers ON customers;
CREATE POLICY tenant_isolation_customers ON customers
  FOR ALL
  USING (tenant_id = NULLIF(current_setting('app.tenant_id', true), '')::uuid);
