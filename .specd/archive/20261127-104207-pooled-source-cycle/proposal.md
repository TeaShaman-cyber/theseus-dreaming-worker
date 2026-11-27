# Proposal: pooled-source-cycle

## Motivation

Issue #89: bounded pooled batch recovery is verified, but the existing complete synthetic source cycle still selects fixed-pair execution only.

## Current behaviour

Pooled callers must compose validated paginated acquisition and bounded batch execution themselves.

## Proposed solution

Expose one explicit pooled synthetic cycle using the existing acquisition and acknowledgement boundaries. Share source preflight and policy snapshot mechanics without changing the fixed-pair API.

## Specs affected

### New specs

None.

### Modified specs

- `default:intake/session-search-boundary`: explicit pooled source cycle.
  - Depends on (added): none

## Impact

Synthetic fixtures only. No default runtime, real history access, permission change, provider activation or deployment.
