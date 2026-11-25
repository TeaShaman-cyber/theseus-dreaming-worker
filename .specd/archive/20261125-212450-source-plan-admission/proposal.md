# Proposal: source-plan-admission

## Motivation

Issue #65: pending metadata custody must precede source-specific inference.

## Current behaviour

A caller can stage a plan independently of the generic durable runner.

## Proposed solution

Source-specific execution uses the existing durable runner with a reservation adapter that verifies the exact staged plan and unadvanced predecessor, and atomically binds the reservation to that plan.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: source-specific reservation admission.
  - Depends on (added): none

## Impact

Thin synthetic-only execution boundary and immutable origin association in the existing ledger.

## Technical context

Use the existing work reservation, completion and lock contracts. Generic synthetic execution is unchanged.

## Open questions

Receipt linkage, historical replan policy and real source authority remain open.
