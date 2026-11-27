# Proposal: ledger-linear-graph-replay

## Motivation

Issue #108 research receipts (7226130905 and 7226246794) demonstrate that monotone edge prefixes are acyclic iff the final graph is acyclic. Prior reverse-chain witness: 13,198 map lookups for 319 events, quadratic work remains after #109.

## Current behaviour

Historical replay checks reachability after every supersession. Every persisted event is read and independently validated.

## Proposed solution

Check schema, identity, uniqueness, and references in original event order; build deduplicated graph, perform one linear topological check before exposing the validated replay. Reuse its ranks for forward edges and prune backward search; invalidate ranks after safe backward insertion. Preserve first-error precedence, standalone append semantics, event history, and full stored-row validation.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/append-only-proposals`: invariant unchanged.
  - Depends on (added): none
- `default:ledger/postgres-storage`: invariant unchanged.
  - Depends on (added): none

## Impact

O(V+E) historical graph work, in addition to reading and validating every event. No storage, permission, deployment or inference change.
