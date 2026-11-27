# Design: pool-completion-custody

## Non-goals
No source cursor wiring, provider calls, raw output retention, ACL redesign or deployment.

## Affected areas
- `src/dreaming/proposal-ledger-postgres.ts`: locked custody guard and explicit pooled writer.
- `src/dreaming/pool-completion.ts`: shared deterministic projection builder.
- `src/dreaming/pooled-durable-pilot2.ts`: reuse builder.
- `test/durable-pilot2.test.mjs`, `test/proposal-ledger-postgres.test.mjs`: SQL and replay negative tests.
- `qa/postgres/pool-attempt-journal.mjs`: real PG rejection and successful exact completion.

## Approach
Reuse the existing work-completion transaction, not a parallel write path. Ordinary complete must see no pool journal under the lock. Pooled complete requires original exact input, owner, complete journal and recomputed exact projection under the same lock, before any records are inserted. Keep context immutable and independent readback. This is trusted application writer correctness, not protection against direct SQL access.

## Testing
Synthetic reproduction on PostgreSQL, rejected ordinary and incomplete or mismatched pooled candidates, accepted exact completed journal, existing fixed-pair path unchanged. Fast injected SQL client tests cover transaction, rejection, readback. Existing mutation threshold unchanged.

## Spec impact
Adds storage-level custody enforcement, no change to permission or source acknowledgement policy.
