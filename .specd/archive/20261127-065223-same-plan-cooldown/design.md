# Design: same-plan-cooldown

## Non-goals

No cross-plan/account-wide quota inference, provider identity discovery, global scheduler, indefinite shared bans, or revocation of already admitted STARTs.

## Affected areas

- `src/dreaming/pool-attempt-journal.ts` — typed pre-start deferral.
- `src/dreaming/proposal-ledger-postgres.ts` — optional source projection and atomic recheck.
- `src/dreaming/pooled-durable-pilot2.ts` — merge projected restrictions and preserve typed pre-start deferral.
- `src/dreaming/source-batch-postgres.ts` — scope journal query to exact staged plan.
- `test/pooled-durable-pilot2.test.mjs` — selection, deferral and restart.
- `test/proposal-ledger-postgres.test.mjs` — locked wait check, exact expiry, client lifecycle and outcome append.
- `qa/postgres/work-atomicity-probe.mjs` — actual PostgreSQL cross-work wait and race control.

## Approach

Reuse trusted append-only journal events and source origin join. Only known HTTP 429 with finite Retry-After and provider-scoped deadline propagates. Provider key is the caller's stable namespace within the exact plan, not independently verified account identity. Merge by maximum deadline; read only candidate keys. Same ledger lock linearizes known failure publication and START admission. A deadline learned after selection but before START rejects that START without writing or calling; return DEFERRED for caller re-evaluation. Already-admitted STARTs are not revoked. Unknown outcome and indefinite per-work refusal rules remain unchanged.

## Testing

Synthetic executor tests, actual PostgreSQL cross-work pre-expiry deferral and alternate choice, expiry, and a race where restriction commits between selection and locked START. No real calls or production state.

## Spec impact

Add finite same-plan cooldown requirement. No new schema, role grants, or source acknowledgement authority.
