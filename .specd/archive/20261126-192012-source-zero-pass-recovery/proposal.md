# Proposal: source-zero-pass-recovery

## Motivation

Issue #65: a worker may stop after durable completion but before source acknowledgement. The existing runner rejects even readback-based acknowledgement when less than two passes remain.

## Current behaviour

Budget exhaustion returns before checking whether every selected work is already complete.

## Proposed solution

On insufficient remaining budget invoke only the existing verified acknowledgement primitive, preserving PENDING, conflict and uncertainty distinctions. Never reserve or invoke models in this branch.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: clarify zero-pass recovery of fully completed work.
  - Depends on (added): none

## Impact

Bounded portable runner and focused regressions. No schema, permissions or new model route.

## Technical context

Existing acknowledgement checks current staged plan, original plan binding and all durable completions inside the ledger transaction.

## Open questions

None in the synthetic boundary.
