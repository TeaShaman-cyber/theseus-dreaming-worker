# Proposal: pool-completion-custody

## Motivation
Issue #89 isolated PG17 counterexample: ordinary completion persists while the pool journal has pending START and zero validated slots.

## Current behaviour
The executor checks the projection, but the ordinary PostgreSQL write boundary accepts independently constructed work completion.

## Proposed solution
Reject ordinary completion when a pool journal exists. Provide explicit input-bound pooled completion writer verifying exact journal replay and projection inside the existing transaction lock.

## Specs affected
### New specs
None.
### Modified specs
- `default:ledger/postgres-storage`: enforce pooled completion custody at the storage boundary.
  - Depends on (added): none

## Impact
Existing ordinary trusted-caller completion and source admission remain intact. No new schema, permission or runtime deployment.
