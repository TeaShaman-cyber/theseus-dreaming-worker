# Proposal: durable-pilot2-composition

## Motivation

Issue #65 and the PostgreSQL work-atomicity pilot demonstrated unique reservation, rollback and exact membership readback. Connect the verified mechanism to the actual bounded Pilot 2 runner, rather than manually inserting synthetic records in a standalone probe.

## Current behaviour

Checkpoint admission is accepted in main (#64); PR51 storage adapter is still being reviewed on updated main. Neither owns the complete work transaction.

## Proposed solution

Reuse deterministic checkpoint preparation, reserve by stable work identity before invoking models, and build validated ledger records with work-scoped perspective IDs. Persist an append-only completion and its exact record membership in one transaction. On a failed or ambiguous commit, read back the exact independently verified projection; never repeat inference.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: add work admission and atomic batch completion requirements.
  - Depends on (added): none

## Impact

Lab-only source and database integration, existing PostgreSQL test lane, no new service.

## Technical context

Reuse createProposalRecord, appendLedgerEvent, pg Client and checkpoint identity from the accepted bounded runner. Use actual hosted PostgreSQL acceptance. Existing source authority and egress boundaries remain unchanged.

## Open questions

Automatic recovery of an unresolved reservation and source-level cursor progression remain separate; a stuck reservation is explicit and not retried.
