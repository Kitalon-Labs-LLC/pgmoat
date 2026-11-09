# Read-only role baseline results

What a least-privilege database role does on its own, with no pgmoat in front. Each file is the
output of `tools/readonly-role-baseline.mjs` for one case set on one Postgres version. The role is
`pgmoat_reader` from `packages/core/test/integration/harness/roles.sql`. It has SELECT on the
exposed tables and column grants that leave out the hidden columns.

| File | Set | Postgres | Role alone | pgmoat |
|---|---|---|---|---|
| `corpus-pg14.json` | 321-case corpus | 14.24 | 262 / 321 | 321 / 321 |
| `corpus-pg15.json` | 321-case corpus | 15.19 | 266 / 321 | 321 / 321 |
| `corpus-pg16.json` | 321-case corpus | 16.15 | 266 / 321 | 321 / 321 |
| `corpus-pg17.json` | 321-case corpus | 17.11 | 266 / 321 | 321 / 321 |
| `corpus-pg18.json` | 321-case corpus | 18.6 | 266 / 321 | 321 / 321 |
| `heldout-pg14.json` | 80 held-out cases | 14.24 | 60 / 80 | 80 / 80 |
| `heldout-pg15.json` | 80 held-out cases | 15.19 | 60 / 80 | 80 / 80 |
| `heldout-pg16.json` | 80 held-out cases | 16.15 | 60 / 80 | 80 / 80 |
| `heldout-pg17.json` | 80 held-out cases | 17.11 | 60 / 80 | 80 / 80 |
| `heldout-pg18.json` | 80 held-out cases | 18.6 | 60 / 80 | 80 / 80 |

On Postgres 15 to 18 every case gets the same verdict. Only the error code differs in a few cases,
because `MERGE ... RETURNING` is a syntax error before Postgres 17. On Postgres 14 the role also
lets `CREATE TABLE`, `CREATE VIEW`, `CREATE FUNCTION` and `SELECT INTO` through, because every role
could create objects in schema `public` before Postgres 15. pgmoat supports Postgres 15 to 18; 14 is
here only to show that difference.

A miss means the role did not refuse a query that pgmoat must refuse. It is not always a leak.
Postgres does not run a CTE that the query never reads, and views such as
`information_schema.columns` and `pg_stats` show only what the role may see.

## Reproduce

CI reruns every file on each push (job "Read-only role baseline") and fails if any verdict changes.
To run one by hand:

```
docker run -d --name pgbase -p 5433:5432 -e POSTGRES_HOST_AUTH_METHOD=trust postgres:17
createdb -h 127.0.0.1 -p 5433 -U postgres testdb
for f in seed roles rls; do psql -h 127.0.0.1 -p 5433 -U postgres -d testdb -v ON_ERROR_STOP=1 -f packages/core/test/integration/harness/$f.sql; done
node tools/readonly-role-baseline.mjs . corpus.json --set corpus
node tools/readonly-role-baseline.mjs . heldout.json --set heldout
```
