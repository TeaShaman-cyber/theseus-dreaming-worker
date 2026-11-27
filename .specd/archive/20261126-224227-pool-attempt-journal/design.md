# Design: pool-attempt-journal

## Non-goals

No takeover of legacy reservations, hidden retry, source acknowledgement, paid calls, or production migration.

## Affected areas

- `src/dreaming/pool-attempt-journal.ts` — strict event replay and bound packet identity.
- `src/dreaming/proposal-ledger-postgres.ts` — admission, append and independent readback under existing lock.
- `infra/postgres/dw_ledger_v1.sql` — append-only journal table referencing existing reservation.
- `infra/postgres/verify_dw_ledger_v1.sql` — grant validation.
- `test/pool-attempt-journal.test.mjs` — state transitions.
- `qa/postgres/pool-attempt-journal.mjs` — real restart/concurrency/unknown tests.
- `tools/ci/heavy-postgres` — reuse existing PostgreSQL QA.

## Approach

Journal events are validated and hashed after canonical schema parsing. Admission fixes work, exact request and evidence fingerprints and total attempt budget. A start names a unique attempt and eligible route supplied by the trusted caller, uses the next unfilled slot, and is appended only against exact previous journal tip. A known terminal failure may leave the slot open; a validated proposal set is immutable and rechecked against original evidence; unknown or pending attempts block further starts. Store uses existing transaction-scoped lock and original reservation foreign key. No automatic legacy adoption. Caller receives dispatch permission only from a confirmed append and exact independent readback; uncertain commit remains blocked. No inference in storage API.

## Testing

State tests, concurrent claim conflict, restart readback, known failure then replacement, unknown stop, request mismatch, append-only grants and existing PG contract.

## Spec impact

Additive partial-state custody, not yet full source execution or completion integration.
