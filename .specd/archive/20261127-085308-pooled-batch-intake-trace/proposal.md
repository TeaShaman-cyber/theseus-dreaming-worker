# Proposal: pooled-batch-intake-trace

## Motivation

Issue #89: the exact committed batch-run diff failed native trace coverage because the source runner has an existing intake specification link, whereas the new archive covered only ledger storage.

## Current behaviour

The pooled batch implementation and ledger requirement exist, but the linked intake spec does not describe its composition.

## Proposed solution

Add the intake-side bounded pooled orchestration contract and scenario. Preserve the previous ledger archive and existing source custody. No runtime change or gate weakening.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: pooled batch orchestration boundary.
  - Depends on (added): none

## Impact

Correct source traceability; no authority, implementation or deployment change.
