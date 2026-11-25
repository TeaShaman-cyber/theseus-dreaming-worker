# Design: source-batch-store

## Non-goals

No production migration, permissions, scheduler, external inference, pending batch custody or empty/removal disposition.

## Affected areas

- `src/dreaming/source-batch-receipt.ts` — reuse receipt digest and input type.
- `src/dreaming/source-batch-postgres.ts` — thin PostgreSQL store.
- `infra/postgres/dw_ledger_v1.sql` — one append-only checkpoint table.
- `infra/postgres/verify_dw_ledger_v1.sql` — grants and constraints verification.
- `qa/postgres/work-atomicity-probe.mjs` — real store contract.
- `docs/ledger-neon.md` — explicit lifecycle and limitations.

## Approach

Chain key binds provider, source scope, task and version. Explicit root persists full trusted previous membership, unique root/child enforced by database. Acknowledgement checks exact parent and recomputes receipt with the existing work reader on the same locked transaction. Insert only, then fresh-client exact readback, including after ambiguous commit. Return PENDING or CONFLICT/UNKNOWN without inference. Trusted ledger writers must obey the existing lock and append-only contract; independent corruption checks do not establish source authority.

## Testing

Use existing disposable PostgreSQL contract, real completions and fixture pages. Test no implicit root, incomplete, competing roots/children, readback and lost acknowledgement, wrong membership and intent, no update/delete. No live resources.

## Spec impact

Extends existing storage adapter while leaving portable analysis independent.
