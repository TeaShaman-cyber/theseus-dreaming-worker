# Design: source-zero-pass-recovery

## Non-goals

No new database, live migration, source reader, model calls, implicit bootstrap or takeover.

## Affected areas

- `src/dreaming/source-batch-run.ts` — use the existing exact acknowledgement boundary on budget exhaustion.
- `test/source-batch-run.test.mjs` — completed-before-ack recovery, partial and unknown controls.
- `qa/postgres/work-atomicity-probe.mjs` — durable zero-pass recovery after caller interruption.
- `docs/ledger-neon.md` — document distinction between acknowledgement attempt and committed checkpoint.

## Approach

After current tip and exact staging checks, if fewer than two passes remain, do not call runSelected. Invoke acknowledge on the exact input. Only an independently verified exact receipt permits ACKNOWLEDGED or ALREADY_ACKNOWLEDGED. PENDING returns BUDGET_EXHAUSTED; CONFLICT and uncertainty stay explicit. A partial acknowledgement attempt cannot advance source progress because the existing primitive verifies every completion and original plan. Work summaries continue to describe only attempted selected-work calls; the receipt is authoritative for the complete batch. No new store operation.

## Testing

Failing regression seeds all selected completions while simulating a lost acknowledgement before retry with zero budget; assert no calls or reservations added. Partial batch still cannot advance; unknown and conflicting acknowledgement are not masked.

## Spec impact

Existing no duplicate inference, budget and source checkpoint invariants; add explicit verification scenario.
