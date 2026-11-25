# Design: source-plan-admission

## Non-goals

No live migration, actual history, scheduler, model provider calls, stale replay or source acknowledgement.

## Affected areas

- `src/dreaming/source-batch-receipt.ts` — shared exact plan and input preparation.
- `src/dreaming/source-batch-postgres.ts` — selected execution with scoped reservation.
- `infra/postgres/dw_ledger_v1.sql` — immutable work-to-plan association.
- `infra/postgres/verify_dw_ledger_v1.sql` — append-only grant and FK checks.
- `qa/postgres/work-atomicity-probe.mjs` — hosted acceptance.
- `docs/ledger-neon.md` — scope and retention.

## Approach

The portable preparation derives plan and verified work from one input snapshot. PostgreSQL source-specific execution wraps existing WorkStore reservation under the existing ledger lock, validates exact stored plan and predecessor, and inserts a single origin link with the new reservation in the same transaction. Use existing generic completion and read methods. Existing reservation must have a verified plan origin for source-specific reuse; never replace it. Return existing durable runner decision. No transaction is held across inference. Source checkpoint acknowledgement remains a separate action.

## Testing

Hosted PostgreSQL missing plan, exact stage and run, restart/replay, immutable origin and zero additional calls. Existing full QA. No local PostgreSQL duplication.

## Spec impact

Adds a bounded admission path; not global authorization of the generic runner.
