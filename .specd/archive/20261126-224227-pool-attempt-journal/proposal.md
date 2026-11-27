# Proposal: pool-attempt-journal

## Motivation

Issue #89: one successful perspective must survive the other route failing and a process restart.

## Current behaviour

Work reservation is unique, but a partial analysis cannot be resumed durably.

## Proposed solution

Append an immutable admission and per-attempt start/outcome events to the same work reservation, with compare-and-swap journal identity and independent readback. Preserve validated slots and block ambiguous execution.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: additive bounded attempt custody contract.
  - Depends on (added): none

## Impact

New candidate storage API and additive SQL schema; no live deployment, scheduler wiring, source cursor change or provider calls.

## Technical context

Reuse existing reservation and ledger transaction lock. Existing completion path remains unchanged.

## Open questions

Connect actual provider observations and full completion in a later integration change.
