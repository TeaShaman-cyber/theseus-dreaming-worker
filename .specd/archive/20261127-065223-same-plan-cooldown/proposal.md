# Proposal: same-plan-cooldown

## Motivation

Issue #89: a known finite provider Retry-After in one selected work must not be forgotten by the next work of the same staged plan.

## Current behaviour

Each pooled work replays its own attempts only. The next work can choose a provider whose known wait is still active.

## Proposed solution

Project finite provider-scoped HTTP 429 deadlines from journal entries joined to immutable origins within the exact same staged plan. Read before selection and recheck under the existing ledger transaction lock before START. Do not introduce a second durable store.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: same-plan finite provider cooldown.
  - Depends on (added): none

## Impact

Synthetic same-plan scope only. No account-wide quota inference, new provider permissions, deployment or actual inference.
