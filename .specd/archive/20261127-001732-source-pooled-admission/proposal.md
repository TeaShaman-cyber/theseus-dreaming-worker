# Proposal: source-pooled-admission

## Motivation

Issue #89: reuse durable partial work for verified synthetic Session Search batches, without allowing unbound reservations or relabelling original work.

## Current behaviour

Source admission binds only the fixed pair runner. The pooled executor has independent journal custody but cannot bind a source plan atomically.

## Proposed solution

Add an explicit same-plan selected-session pooled entry point. Bind the initial journal and original plan in one existing locked transaction. Check exact staged plan and original work before dispatch and readback.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: source-bound pooled admission.
  - Depends on (added): none

## Impact

Synthetic input only. No replacement of existing fixed-pair path, real history access, new model permission or deployment.
