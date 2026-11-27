# Proposal: ledger-rank-mutation-witness

## Motivation

Issue #108, PR #110 exact 5af5588: six surviving ledger mutations; three lose rank optimization, two compare equal ranks of distinct vertices, one injects a phantom target into an empty adjacency default.

## Current behaviour

Historical topological ranks are injective over existing proposal IDs, extended for newly validated distinct proposals and invalidated after safe backward insertion.

## Proposed solution

Add deterministic work-bound test for rank retention across proposal and forward appends. Document two exact equivalent comparison mutants and replace empty adjacency fallback with explicit absent-adjacency branch. No semantics change.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/append-only-proposals`: invariant unchanged.
  - Depends on (added): none

## Impact

No storage, inference, permission or accepted event behavior change.
