# Proposal: pooled-durable-execution

## Motivation

Issue #89: combine bounded route selection and immutable partial custody into a real resumable two-perspective work executor.

## Current behaviour

The selector and journal are independently verified but do not execute or complete work.

## Proposed solution

Compose the existing Pilot 1 adapter, selection, journal CAS and completion-only recovery. Invoke at most one missing perspective at a time; preserve known failures and unresolved outcomes.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: bounded pooled execution and completion verification.
  - Depends on (added): none

## Impact

Explicit candidate API only, not default source-batch execution, production deployment or new provider authority.

## Technical context

Issue #89, existing two-pass executor, Pilot 1 validator, journal and completion recovery.

## Open questions

Source-plan admission integration and cross-work provider cooldown custody remain separate.
