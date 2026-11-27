# Design: ledger-single-pass-replay

## Non-goals

No skipping validation of persisted rows, global cache, indexed-only admission, weaker locking or new database objects. No production scaling claim.

## Affected areas

- `src/dreaming/proposal-ledger.ts` — transaction-local accumulator with ordered snapshots and indexes; reuse pure validators.
- `src/dreaming/proposal-ledger-postgres.ts` — reconstruct and validate history once, then append candidates to the same accumulator under existing lock.
- `test/proposal-ledger.test.mjs` — differential prefix replay, corruption/duplicates/reference/cycle and linear clone-work bound.
- `test/proposal-ledger-postgres.test.mjs` — storage read and append boundary regressions.

## Approach

Each append clones and parses its candidate, recomputes identities, checks event ID uniqueness, checks both references and reachability before adding an edge, and publishes only after validation. Maintain sets and adjacency in a private closure; snapshot returns independent copies. Full replay accepts exactly valid ordered prefixes, including rejecting corrupt unrelated stored records before insert. Legacy standalone appendLedgerEvent retains its semantics for arbitrary caller histories; share checks where practical without silently tightening its acceptance of malformed existing graph prefixes. Existing DB SQL, lock, rollback, membership and readback remain unchanged. Complexity O(N) for proposal-only history, plus reachability traversals for supersession edges; not a proof of O(N) for arbitrary DAG. Full history transfer remains O(N).

## Testing

Deterministic clone-count witness (not timing threshold), differential comparison against legacy replay on valid and invalid histories, caller/snapshot isolation, existing unit and isolated PostgreSQL suite, before/after synthetic benchmark and exact hosted mutation/review. Keep threshold and scope.

## Spec impact

No-op deltas: all persisted events still validated through same append-only semantics, not assumed trusted.
