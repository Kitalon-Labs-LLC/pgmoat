# pgmoat

> Governed Postgres access for AI agents.

An open-source Model Context Protocol (MCP) server that provides AI agents with secure, read-only access to PostgreSQL databases through multi-layered SQL safety, least-privilege visibility, identity-bound Row-Level Security (RLS), context budgets, and tamper-evident audit logging.

## Installation

```bash
npx -y pgmoat postgresql://user:password@localhost:5432/mydb
```

Or add to Claude Code:
```bash
claude mcp add pgmoat -- npx -y pgmoat postgresql://user:password@localhost:5432/mydb
```

## What pgmoat Does Not Do

- **It does not stop prompt injection.** It removes the write path, hides what you mark hidden, and labels returned data as untrusted, but an agent with other tools (web access, email) can still be tricked into sending readable data elsewhere.
- **It does not replace Postgres permissions.** The strongest control is a dedicated Postgres role with only the grants it needs. pgmoat checks for this and warns if over-privileged, but the operator owns database role configuration.
- **It does not make RLS policies correct.** It sets the session variables your policies read from trusted identity claims. If a policy is logically flawed, pgmoat cannot fix it.
- **It does not see triggers, views with side effects, or functions it does not know.** It denies unknown functions by default.
- **It does not guarantee audit delivery to a remote destination during an outage.** It buffers, alarms, and records drops.

## Quickstart

*Coming soon.* See [spec/08-pgmoat-implementation-plan.md](spec/08-pgmoat-implementation-plan.md) for roadmap and milestones.

## Safety Model

See [spec/03-pgmoat-technical-architecture.md](spec/03-pgmoat-technical-architecture.md) for the multi-layer defense-in-depth safety pipeline, AST-level validation, and execution invariants.

## License

MIT © 2026 Kitalon Labs
