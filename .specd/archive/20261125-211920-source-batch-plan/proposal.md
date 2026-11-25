# Proposal: source-batch-plan

## Motivation

Issue #65: a worker can stop after individual completion but before source acknowledgement. A later generation can retain the same content identity while losing original source custody.

## Current behaviour

The source store persists acknowledged batches, but has no durable pending source witness.

## Proposed solution

Stage immutable metadata-only plans derived by the existing verified selected-work admission. Preserve multiple plans for one unadvanced predecessor so original lineage is not replaced by a fresh observation.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: pending source plan custody.
  - Depends on (added): none

## Impact

One append-only metadata table in the existing ledger, reusable deterministic plan builder, stage/read methods. No production migration.

## Technical context

Recompute bounded inputs from trusted source; plan is a witness, not a queue or permission to read historical generations.

## Open questions

Runtime enforcement before reservation, completion-to-original-witness linkage, stale replan policy and real metadata retention require separate acceptance.
