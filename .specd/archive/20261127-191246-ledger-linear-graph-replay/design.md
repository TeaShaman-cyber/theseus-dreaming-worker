# Design: ledger-linear-graph-replay

## Non-goals

No trusted cache, sublinear physical history checks, schema/SQL change, graph service, transitive reduction, storage authority or runtime access change.

## Affected areas

- `src/dreaming/proposal-ledger.ts` — ordered basics validation, final Kahn ranks, rank-filtered candidate append, conservative rank invalidation.
- `src/dreaming/proposal-ledger-postgres.ts` — lazy row reconstruction in original SQL order into the validated replay.
- `test/proposal-ledger.test.mjs` — linear work, graph parity, first-error precedence, backward edge invalidation and rank pruning.
- `test/proposal-ledger-postgres.test.mjs` — earlier graph failure vs later malformed row; rollback before insert.

## Approach

A cycle in any append-only prefix persists in later prefixes. Check all ordered non-graph invariants, then run Kahn using distinct adjacency pairs and an append-only queue, with all proposal vertices including isolated ones. If iterator/row/basic validation throws, check the successfully indexed prefix for a cycle first; this preserves the earlier legacy cycle error, otherwise rethrow the original error. Do not expose the index until all checks pass. A strict topological rank excludes reverse reachability for a forward edge, and no path can pass a rank beyond its destination. After an accepted backward edge discard ranks rather than using stale certificates; subsequent appends use exact DFS. New isolated proposals extend valid rank maps. No rank assumption in standalone append. Preserve parallel event records independently from deduplicated adjacency.

## Evidence and testing

Issue #108 contains checked Lean monotone-path and rank lemmas, graph-only exhaustive and timing witnesses, and Kusto-guided formal source retrieval. These are abstract proofs, not a verified refinement of TypeScript. Test 3-vertex histories in both orders, valid/invalid mixed histories and persisted malformed rows, rank invalidation, deterministic map-read bounds, snapshot ownership, all canonical QA and isolated PostgreSQL, hosted mutation and review. Valid historical replay graph work O(V+E), not necessarily all future dynamic append costs; physical full-history reads remain.

## Spec impact

No-op deltas. Preserve every persisted-row identity check and original ordered acceptance.
