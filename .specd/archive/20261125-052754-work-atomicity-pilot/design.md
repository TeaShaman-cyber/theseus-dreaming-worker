# Design: work-atomicity-pilot

## Non-goals

No runtime storage API, automatic retry, scheduler, model invocation or accepted migration change. No second database or service.

## Affected areas

- `qa/postgres/work-atomicity-probe.sql` — isolated research tables and append-only test-role grants.
- `qa/postgres/work-atomicity-probe.mjs` — actual PostgreSQL concurrent reservation, atomic commit, rollback and readback scenarios.
- `tools/ci/heavy-postgres` — invoke the research probe on the existing disposable hosted database.

## Approach

A unique work key admits exactly one of two independent contenders via INSERT ON CONFLICT DO NOTHING RETURNING. The reservation is committed before simulated analysis. A completion references the winning reservation and records via foreign keys. Real ledger proposal inserts, completion and membership execute inside one transaction. Inject rollback and wrong owner failures. Check committed rows from a separate connection. Simulate lost acknowledgement after commit and recover by reading the persisted receipt without granting another reservation. Exercise the existing runtime role and reject update/delete. Use a guarded disposable fixture schema only.

## Testing

Run the existing hosted PostgreSQL contract including the new research probe. Locally verify JS syntax and existing QA. Record hosted result before interpreting the experiment as evidence. The pilot is not a replacement for application integration tests.

## Spec impact

None normative. Existing ledger semantics unchanged. The hypothesis under test is that SQL constraints and transactions suffice for this mechanism.
