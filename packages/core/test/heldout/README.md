# Held-out safety cases

These 80 cases were written on 2026-11-09, after the 321-case corpus in `../corpus/cases/` was frozen
(git tag `corpus-321-frozen`). They were committed before pgmoat was run on them, so the git
history shows the expectations came first. None of them repeats a corpus query.

They are kept apart from the corpus on purpose. The corpus is a regression suite: every case
passes, and a case is fixed when it fails. This set is a measurement. Its results are reported as
they come out, misses included, and a miss is fixed in pgmoat, not by editing the expectation.

## How a case is scored

- Each case says `expect: refused` or `expect: allowed`. The expectation follows from the
  guarantees in the pgmoat technical report (read-only, one statement, hidden data stays hidden,
  bounded rows) and from the rule that unknown functions are denied by default. It was not taken
  from pgmoat's source code.
- A case is **correct** when pgmoat's decision matches: it refuses an `expect: refused` case, or
  allows an `expect: allowed` case. The `PGM-` code is recorded but does not affect the score.
- Every case runs through the same pipeline and fixture policy as the corpus: hidden tables
  `internal_audit` and `api_keys`, hidden columns `users.password_hash` and `users.mfa_secret`,
  `max_rows` 200. Cases with `mode: explain` run in EXPLAIN mode.
- An expectation that turns out to be wrong is not edited. It is listed in `RESULTS.md` with the
  reason.

## Run

```
pnpm test:heldout
```

This writes `results.json` next to this file and prints a summary. It never fails on a miss.
