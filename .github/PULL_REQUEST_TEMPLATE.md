## Description

<!-- Describe your changes and the rationale behind them. -->

## Related Specifications / TRD IDs

<!-- Reference the applicable TRD IDs (e.g. SEC-INJECT-01, R12) -->

## Checklist

- [ ] Tests added/updated for all new behavior
- [ ] Adversarial corpus cases added under `packages/core/test/corpus/cases/` if modifying `packages/core/src/safety/`
- [ ] Documentation updated to reflect changes
- [ ] No SQL string concatenation or template literal building (`pgmoat/no-sql-string-building` passes)
- [ ] DCO sign-off included (`git commit -s`)
- [ ] Changeset created (`pnpm changeset`) if user-facing
