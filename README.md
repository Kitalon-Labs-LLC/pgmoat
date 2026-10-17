# pgmoat build bundle

Spec set and Claude Code prompt pack for **pgmoat**, an open-source MCP server that gives AI agents governed, read-only access to Postgres. Prepared 2026-10-17 by Kitalon Labs.

## Files, in reading order

| # | File | What it is | Who reads it |
|---|---|---|---|
| 0 | `HANDOFF.md` | Short brief for the developer | Developer, first |
| 1 | `00-pgmoat-research-and-changes.md` | What changed since the May 2026 specs, with sources and confidence | Developer (skim), reviewers |
| 2 | `01-pgmoat-prd.md` | What we are building and why; requirements R1 to R30 | Everyone |
| 3 | `02-pgmoat-feature-spec.md` | Exact behavior of every feature, with acceptance tests | Developer |
| 4 | `03-pgmoat-technical-architecture.md` | Stack, layout, request lifecycle, safety pipeline, auth, distribution | Developer |
| 5 | `04-pgmoat-trd.md` | Traceable requirements with verification methods and the ship gate | Developer, reviewers |
| 6 | `05-pgmoat-backend-schema.md` | Canonical: audit DDL, runtime types, config schema, error codes | Developer (reference) |
| 7 | `06-pgmoat-ui-ux-design.md` | CLI transcripts, tool texts, output formats, docs site IA | Developer |
| 8 | `07-pgmoat-appflow.md` | Journeys, request flows, deployment diagrams (Mermaid) | Developer, reviewers |
| 9 | `08-pgmoat-implementation-plan.md` | Phases, dates, gates | Developer, Sowad |
| 10 | `09-pgmoat-claude-code-prompts.md` | 80+ atomic Claude Code prompts with gates | Developer (daily driver) |
| 11 | `CLAUDE.md` | Rules file for the repo root; Claude Code reads it automatically | Claude Code |

## Precedence when documents disagree

1. `05-pgmoat-backend-schema.md` for names, types, defaults, config fields, error codes.
2. `03-pgmoat-technical-architecture.md` for how things are built.
3. `02-pgmoat-feature-spec.md` for behavior.
4. `01-pgmoat-prd.md` for scope and priority.

Report conflicts instead of guessing; fix the spec first.

## Open decisions for Sowad

- OD-01: confirm or register the docs domain (pgmoat.dev assumed).
- OD-02: trademark knockout search before any filing.
- OD-03: HTTP transport in v1.0 or v1.1 (decide at M1, 2026-11-13).
- OD-04 to OD-07: see PRD section 15.
