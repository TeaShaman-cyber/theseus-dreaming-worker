# Design: ledger-storage-acceptance

## Non-goals

No new storage architecture, credentials, live database mutation, or checkpoint integration.

## Affected areas

- `src/dreaming/proposal-ledger-postgres.ts` — existing proposed PostgreSQL adapter; verify exact connection, transaction and row validation.
- `infra/postgres/dw_ledger_v1.sql` — existing proposed shared event sequence and append-only schema.
- `infra/postgres/verify_dw_ledger_v1.sql` — existing SQL verification.
- `package.json` — existing explicit pg dependency.
- `pnpm-lock.yaml` — existing locked pg dependencies.
- `test/proposal-ledger-postgres.test.mjs` — add actual client constructor and transaction-order witnesses, null-field tests.
- `specs/ledger/postgres-storage/spec.md` — normalize existing requirement headings.
- `specs/ledger/postgres-storage/verify.md` — correct PostgreSQL version and add verification.
- `docs/qa.md` — preserve both database and SpecD QA routing when merging main.

## Approach

Merge current main without overwriting neighboring work. Use the actual pg.Client with mocked connect/query/end only to observe connection parameters without network access. Exercise malformed rows and transaction ordering on a strict fake; retain real hosted PG and Neon schema-only QA. Do not change runtime implementation to silence survivors.

## Testing

Reproduce each observed mutation in isolated temporary source copies, assert failure with enhanced tests, and confirm unchanged adapter passes. Run canonical QA and hosted mutation/PG/Neon checks.

## Spec impact

Existing proposed storage contract remains intact; verification is strengthened. No change to ledger or source authority.
