# Customer Support Agent Example

This example demonstrates deploying `pgmoat` for customer support and ticketing agents handling untrusted user input.

## Architecture

- **Threat Context**: Support tickets regularly contain untrusted external text, including deliberate prompt injection attempts (e.g., instructions attempting to deceive the model into dumping credentials).
- **Defense in Depth**:
  - Sensitive columns (`credit_card`) are masked at the AST layer before query dispatch.
  - Complete prompt input queries are recorded to `support-audit.log` for security telemetry.
  - No write paths exist, neutralizing data modification attacks.

## Directory Structure

- `docker-compose.yml`: Spawns a PostgreSQL 17 test service.
- `seed.sql`: Creates `customers`, `tickets`, and `ticket_messages` tables with realistic customer interactions and adversarial injection strings.
- `pgmoat.yaml`: Server policy masking payment card columns.
- `client.mjs`: Node.js client demonstrating safe retrieval of ticket messages and refusal of sensitive card queries.

## Quickstart

1. Start the database service:
   ```bash
   docker compose up -d
   ```

2. Run the support agent test:
   ```bash
   node client.mjs
   ```

3. Clean up:
   ```bash
   docker compose down -v
   ```

