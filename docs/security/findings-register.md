# Security Findings Register

This register documents security gaps, bypass vectors, and edge cases discovered during internal reviews and penetration testing of pgmoat's query safety engine, along with their remediation and tracking identifiers.

| Finding ID | Severity | Status | Description | Remediation |
|---|---|---|---|---|
| **F-P2-01** | High | Resolved | CTE self-shadowing hides real table columns but allows querying hidden fields from shadowed table. | Refuse queries when CTE name shadows a known table with hidden columns or validate CTE column references against policy. |
| **F-P2-02** | High | Resolved | Column alias lists (e.g. `SELECT c FROM users u(a,b,c)`) bypass column-level visibility checks. | Reject column renaming aliases (`RangeVar.alias.colnames`) on tables containing hidden columns (`PGM-208`). |
| **F-P2-03** | High | Resolved | `USING` clauses and `NATURAL JOIN` on tables with hidden columns bypass explicit column restrictions. | Inspect `JoinExpr.usingClause` for hidden column references; reject `NATURAL JOIN` on tables containing hidden columns (`PGM-208`). |
| **F-P2-04** | High | Resolved | Four-part qualified column references (e.g. `db.schema.table.column`) bypass three-part field parser in column safety checks. | Parse up to 4-part qualified references (`[database, schema, table, column]`) in column walker. |
| **F-P2-05** | High | Resolved | Object identifier casts (`::regclass`, `::regrole`, `::regnamespace`, etc.) referencing hidden relations or namespaces allow probing existence. | Check `TypeCast` nodes with reg* target types; refuse if string constant targets a hidden relation or namespace (`PGM-207`). |
| **F-P2-06** | Medium | Resolved | Deeply nested subqueries (e.g. >300 levels) throw uncaught `RangeError` / depth limit exception instead of returning structured refusal. | Wrap `runSafety` pipeline execution in a safety boundary that catches uncaught parsing / AST recursion errors and returns `{ allowed: false, code: 'PGM-206' }`. |

