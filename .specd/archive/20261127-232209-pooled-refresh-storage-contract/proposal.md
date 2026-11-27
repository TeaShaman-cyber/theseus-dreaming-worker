# Proposal: pooled-refresh-storage-contract

## Motivation

#120 changes the storage adapter, linked to ledger/postgres-storage. Hosted diff gate detected the initial archive covered only the intake consumer.

## Current behaviour

Same-plan admission prevents adoption of an alternative journal; the previous intake increment defines zero-call completed reuse.

## Proposed solution

Specify the read-only completed reuse exception to execution admission, without transferring custody or allowing journal mutations.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: completed original custody readback.
  - Depends on (added): none

## Impact

No schema, permissions or deployment change.
