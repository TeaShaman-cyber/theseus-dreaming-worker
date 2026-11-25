# Proposal: work-atomicity-pilot

## Motivation

Issue #65 needs evidence that ordinary PostgreSQL transactions and uniqueness can support duplicate-resistant work admission and atomic persistence before the worker integrates them.

## Current behaviour

The proposed ledger adapter in PR51 persists one event per transaction. PR64 computes candidate checkpoints. Neither provides durable single-winner reservation and batch completion yet.

## Proposed solution

Exercise the candidate database mechanism with two independent connections and existing proposal records in the disposable hosted PostgreSQL contract environment. Use an append-only reservation, completion receipt and record membership; test concurrent admission, rollback and readback after a lost acknowledgement simulation.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: no normative change; investigate the future batch boundary.
  - Depends on (added): none

## Impact

Research fixture and existing database QA runner only. No worker runtime integration or change to the accepted migration. The project is in research/development/test, not operational use.

## Technical context

PR51 candidate 737c8875b3d7135c7e28a25085c1fccdd50c48fa. Existing PostgreSQL 18 hosted contract; local exe.dev has only the client. Reuse actual pg and ledger rows.

## Open questions

Application API, complete result projection, recovery policy and migration design remain #65 implementation work after the mechanism is evidenced.
