# Design: source-batch-run

## Non-goals

No live intake, implicit bootstrap, scheduler, automatic retry, new provider or schema.

## Affected areas

- `src/dreaming/source-batch-run.ts` — portable bounded orchestration.
- `test/source-batch-run.test.mjs` — deterministic stop/budget/replay tests.
- `qa/postgres/work-atomicity-probe.mjs` — real store integration.
- `docs/ledger-neon.md` — invocation semantics.
- `.github/workflows/heavy-postgres.yml` — existing gate trigger.

## Approach

Use structural source store interface, no runtime dependency on PostgreSQL. Snapshot input/routes, prepare exact plan, validate budget/route shape. Read current tip: if different predecessor, only return exact already acknowledged replay from store, otherwise conflict. Stage exact plan and compare readback. Iterate canonical selected order, budget at least two before each call, account attempted passes and stop on any nonterminal decision. Ack only after all work terminal. Return metadata-only summary; store owns verification. Caller supplies synthetic authorized routes and currentness observation; no real transport or source authority.

## Testing

Fast contract tests and existing hosted PostgreSQL runner. Two-pass budget across two works, zero-call exact replay, missing root and uncertain stage, invalid plan/route, failed work. No local PostgreSQL.

## Spec impact

Connects existing primitives without changing their contracts.
