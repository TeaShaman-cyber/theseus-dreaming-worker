# Design: pool-completion-trace-correction

## Non-goals

No new semantics, bypass, or modification of previous archive.

## Affected areas

- `src/dreaming/pool-completion.ts` — shared exact journal projection builder introduced in 7551380.
- `src/dreaming/proposal-ledger-postgres.ts` — existing locked completion custody guard.
- `src/dreaming/pooled-durable-pilot2.ts` — existing shared builder use.

## Approach

Correct the exact design-path relation missing from the preceding archive. Requirement Pooled completion custody remains unchanged. The committed-tree diff gate must verify the corrective archive. Preserve the original failure evidence.

## Testing

Existing 399 unit tests, full PostgreSQL contract and exact committed-tree QA.

## Spec impact

No requirement delta; add explicit verification of the existing trace obligation.
