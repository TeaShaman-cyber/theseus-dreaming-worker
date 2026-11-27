# Proposal: ledger-single-pass-replay

## Motivation

Issue #108: prefix revalidation makes a proposal-only ledger replay quadratic. Baseline 100/250/500/1000 synthetic events on exe.dev: 159/642/2672/12391 ms. Both append and atomic completion hold the existing transaction lock during this replay.

## Current behaviour

Every persisted row is reconstructed then appended to the previously verified array, which clones and revalidates every prefix again. Completion repeats validation for each new record.

## Proposed solution

A transaction-local validation accumulator checks each event identity exactly once in order, tracks all event IDs, proposal IDs and supersession adjacency, and owns its snapshots. Reuse for full read, candidate append, completion batch and materialization. Preserve existing public append contract, including validation of caller-supplied prior events. No cross-transaction cache or storage trust assumption.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/append-only-proposals`: no invariant change.
  - Depends on (added): none
- `default:ledger/postgres-storage`: no integrity or transaction boundary change.
  - Depends on (added): none

## Impact

Reduce repeated CPU work, retain full history reads and graph reachability validation. No schema, permission, deployment or inference change.
