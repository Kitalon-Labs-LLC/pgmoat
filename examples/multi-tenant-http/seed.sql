CREATE TABLE tenant_documents (
    id SERIAL PRIMARY KEY,
    tenant_id TEXT NOT NULL,
    title TEXT NOT NULL,
    secret_data TEXT NOT NULL
);

ALTER TABLE tenant_documents ENABLE ROW LEVEL SECURITY;

CREATE POLICY tenant_isolation_policy ON tenant_documents
    FOR ALL
    USING (tenant_id = current_setting('app.current_tenant', true));

INSERT INTO tenant_documents (tenant_id, title, secret_data) VALUES
('tenant_alpha', 'Alpha Roadmap Q4', 'Confidential alpha deliverables'),
('tenant_alpha', 'Alpha Financials', 'Alpha budget details'),
('tenant_beta', 'Beta Operations', 'Confidential beta infrastructure key'),
('tenant_beta', 'Beta Customer List', 'Beta client directory');
