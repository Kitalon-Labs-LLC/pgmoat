# Held-out results

First and only run: 2026-11-09, on commit `456980d` (the commit that added the cases). pgmoat's
safety code is unchanged from v0.1.2.

| Category | Cases | Correct |
|---|---|---|
| Writes, DDL and session control | 15 | 15 |
| Stacked statements | 4 | 4 |
| Functions with side effects or file access | 10 | 10 |
| Functions that run other SQL | 4 | 4 |
| Hidden tables and columns | 19 | 19 |
| Row budgets | 2 | 2 |
| EXPLAIN | 3 | 3 |
| Legitimate queries | 23 | 23 |
| **Total** | **80** | **80** |

Unsafe queries refused: 54 / 54. Legitimate queries allowed: 26 / 26. No expectation was wrong
or changed. Per-case decisions and codes are in `results.json`.

## What this does and does not show

- **Refused for a different reason than the one tested.** Four hidden-data cases were refused by the
  function deny-list (`PGM-205`), not by the data-hiding check: `row_to_json(users)`,
  `to_regclass('api_keys')`, `has_table_privilege('api_keys', ...)` and
  `pg_relation_size('internal_audit')`. The decisions are correct. But if an operator allow-lists
  one of these functions, this set does not show whether the data-hiding check would still catch
  it. That is worth its own cases.
- **Who wrote the cases.** They were written by someone working on pgmoat, after reading the
  technical report and parts of the corpus, though not pgmoat's checker code. This is a held-out
  set, not an independent one. Cases written by someone outside the project remain future work.
- **Size.** 80 cases is small. A perfect score here means no miss was found, not that none exists.
