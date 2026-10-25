---
'pgmoat': patch
---

Hidden columns now return the same error as columns that do not exist (`PGM-506: column "x" does not exist`), so an agent can no longer confirm which hidden columns exist by guessing names. The audit log still records these attempts as refused. `PGM-208` remains for `*`, whole-row references, column alias lists, and NATURAL JOIN on tables with hidden columns, and its fix text no longer shows an unfilled `<list>` placeholder.
