# Design: durable-pilot2-composition

## Non-goals

No source reader, automatic recovery/lease, scheduler, new provider, external egress or canonical promotion.

## Affected areas

- `src/dreaming/checkpoint-pilot2.ts` — extract reusable strict preparation, no duplicate hashing rules.
- `src/dreaming/durable-pilot2.ts` — reservation, bounded analysis and validated completion projection/readback.
- `src/dreaming/proposal-ledger-postgres.ts` — reuse shared insert and transaction boundary for actual durable work store.
- `infra/postgres/dw_ledger_v1.sql` — append-only reservation/completion/member tables in existing schema.
- `infra/postgres/verify_dw_ledger_v1.sql` — verify additional schema and grants.
- `test/durable-pilot2.test.mjs` — deterministic composition failure tests.
- `qa/postgres/work-atomicity-probe.mjs` — extend real database test with actual composition and fake inference only.
- `scripts/mutation-shards.mjs`, `test/mutation-shards.test.mjs` — cover new runtime source in targeted mutation.
- `docs/ledger-neon.md` — document distinction between completion and source cursor.

## Approach

Prepare once via the existing strict checkpoint parser and work fingerprint. A database reservation is a unique insert returning a token-confirmed row. Readback is always independent after attempted completion. Use existing createProposalRecord and appendLedgerEvent validation; reuse ledger SQL insertion. Store only observed metadata and digest of the ordered projection, not raw model output. Versioned work perspective identity distinguishes otherwise equal records. Fail closed on duplicate record IDs, corrupt readback and ambiguous reservation. Preserve explicit unknown states. Return the in-memory analysis and any uncommitted candidate separately from verified completion; no raw data is reconstructed on replay.

## Testing

Test reservation denial and failure before any inference, concurrent calls, incomplete analysis, commit acknowledgement loss, corrupt projection, and version separation. Exercise actual store with existing hosted PostgreSQL. No real model calls. QA/mutation and native lifecycle before accepting.

## Spec impact

PostgreSQL work boundary extends intake checkpoint without changing source authority. Existing append-only records remain derived only.
