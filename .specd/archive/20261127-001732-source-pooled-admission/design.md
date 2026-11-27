# Design: source-pooled-admission

## Non-goals

No cross-generation partial adoption, batch-level provider cooldown coordination, live source acquisition, or automatic source acknowledgement.

## Affected areas

- `src/dreaming/proposal-ledger-postgres.ts` — explicit trusted source-binding seam within journal reads and locked admission/append.
- `src/dreaming/source-batch-postgres.ts` — derive exact selected work, verify staged plan and immutable origin, compose pooled executor.
- `test/proposal-ledger-postgres.test.mjs` — source-binding ordering and rollback contract.
- `qa/postgres/work-atomicity-probe.mjs` — actual synthetic source admission, partial restart and acknowledgement.

## Approach

Reuse existing source plan and origin validators, existing advisory lock, journal and exact pooled completion writer. A binding verifies staged plan and exact work on every journal observation; writes additionally require the predecessor remain unadvanced. In the initial admission transaction insert reservation, first journal event and origin together. For an existing reservation require its exact same original plan and work identity, never adopt unbound work. A changed plan is refused in this increment even if content identity matches; fixed-pair historical replay is unchanged. Only the existing source acknowledgement builder may advance progress after all selected work completes.

## Testing

Actual PostgreSQL with synthetic callbacks: missing plan and unbound reservation block without calls; 429 then same-plan restart fills only missing slot; changed witness blocked; partial acknowledgement pending; complete batch acknowledged; exact replay zero calls. Injected client tests cover binding order and atomic rollback.

## Spec impact

Adds explicit source-specific pooled path, no permission changes or source cursor advancement by executor.
