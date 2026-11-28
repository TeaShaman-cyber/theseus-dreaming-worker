# Proposal: journal-replay-decomposition

## Motivation

Issue #128: measured replayPoolJournal CC32 even at full observed coverage;
full targeted mutation replay reduced survivors from 45 to 3.

## Current behaviour

One replay loop checks chain, start eligibility, terminal receipt identity,
proposal provenance and cooldown scope.

## Proposed solution

Extract pure start and validated-outcome validation from the replay loop.
Remove the redundant two-validated guard only if the closed slot schema and
existing slot equality check preserve the same rejection.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: unchanged durable attempt contract.
  - Depends on (added): none

## Impact

Local behavior-preserving refactor; no new authority, storage, model dispatch,
or deployment.
