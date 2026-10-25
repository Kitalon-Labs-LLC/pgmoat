CREATE EXTENSION IF NOT EXISTS vector;

CREATE TABLE documents (
    id SERIAL PRIMARY KEY,
    title TEXT NOT NULL,
    content TEXT NOT NULL,
    embedding vector(3) NOT NULL
);

CREATE INDEX ON documents USING ivfflat (embedding vector_cosine_ops) WITH (lists = 1);

INSERT INTO documents (title, content, embedding) VALUES
('PostgreSQL Safety Guidelines', 'Safe SQL querying practices for autonomous agents and LLMs.', '[0.9, 0.1, 0.0]'),
('Vector Search Overview', 'Understanding HNSW and IVFFlat index types in pgvector.', '[0.8, 0.2, 0.1]'),
('Audit Logging Architecture', 'Tamper-evident hash chains and structured NDJSON logging.', '[0.1, 0.9, 0.2]'),
('Multi-Tenant Access Control', 'Row Level Security and session variables for tenant isolation.', '[0.2, 0.8, 0.3]');

