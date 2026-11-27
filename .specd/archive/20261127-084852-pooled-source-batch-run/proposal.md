# Proposal: pooled-source-batch-run

## Motivation

Issue #89: the selected-session pooled runner supports partial restart and same-plan cooldown, but the batch runner still requires exactly two fixed routes.

## Current behaviour

The existing fixed-pair batch contract counts two passes per new work and stops at incomplete work. It cannot represent a pooled partial recovery with one remaining pass, known defer or variable attempts.

## Proposed solution

Add a separate explicit pooled batch entry point that shares existing exact plan and receipt verification, propagates remaining invocation budget and rotation, visits each selected work once and preserves typed deferrals. Stop on unknown or conflicting custody.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: bounded pooled source batch.
  - Depends on (added): none

## Impact

Synthetic composition only. No default runtime or acquisition changes, external model permission, paid calls or deployment.
