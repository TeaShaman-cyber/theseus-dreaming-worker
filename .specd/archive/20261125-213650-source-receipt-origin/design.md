# Design: source-receipt-origin

## Non-goals

No schema addition, real data, live migration, scheduler or inference stage.

## Affected areas

- `src/dreaming/source-batch-postgres.ts` — verify original plan and completion in locked transaction.
- `qa/postgres/work-atomicity-probe.mjs` — unbound rejection, distinct staged witness and commit recovery.
- `docs/ledger-neon.md` — versioned receipt and limitations.

## Approach

Preserve the portable v1 receipt candidate. Store a v2 durable receipt with current plan fingerprint and ordered original plan pointers; derive it within the existing lock. Reuse the original reservation association and compare completion request, packet and evidence identities with original plan metadata. Existing root/receipt readback keeps exact digest verification. No data migration; v1 historical receipt read remains supported but does not assert origin binding.

## Testing

Existing hosted PostgreSQL contract, including generic unbound rejection and two source-admitted completions with a different staged witness. Verify readback and deterministic lost acknowledgement.

## Spec impact

Tightens source-specific checkpoint acceptance.
