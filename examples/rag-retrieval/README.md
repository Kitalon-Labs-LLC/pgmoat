# RAG Retrieval with pgvector Example

This example demonstrates deploying `pgmoat` alongside `pgvector` for Retrieval-Augmented Generation (RAG) knowledge retrieval workflows.

## Architecture

- **PostgreSQL Extension**: `pgvector` enabled on PostgreSQL 17.
- **Similarity Queries**: Distance operators (`<=>` cosine distance, `<->` L2 Euclidean, `<#>` negative inner product) are fully supported in read-only queries.
- **Indexing**: Accelerates queries using IVFFlat or HNSW vector indexes.
- **Safety**: Agents can execute semantic searches and nearest-neighbor lookups while remaining strictly prevented from modifying or dropping embeddings.

## Directory Structure

- `docker-compose.yml`: Spawns a `pgvector/pgvector:pg17` database container.
- `seed.sql`: Creates a `documents` table with 3-dimensional vector embeddings and an IVFFlat index.
- `pgmoat.yaml`: Server configuration with concise row budgets for top-K retrieval.
- `client.mjs`: Test script executing a KNN vector similarity query.

## Quickstart

1. Start the pgvector container:
   ```bash
   docker compose up -d
   ```

2. Run the RAG retrieval test:
   ```bash
   node client.mjs
   ```

3. Clean up:
   ```bash
   docker compose down -v
   ```

