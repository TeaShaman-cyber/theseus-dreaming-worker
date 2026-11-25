# Proposal: source-batch-store

## Motivation

Issue #65: verified batch receipts need durable acknowledgement distinct from individual work completion.

## Current behaviour

The portable receipt builder performs read-only validation.

## Proposed solution

One append-only checkpoint chain in the existing ledger. Explicit trusted root initialization, exact predecessor membership and analysis intent, validated selected work, single successor and independent readback.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: durable source acknowledgement.
  - Depends on (added): none

## Impact

Synthetic-only adapter and versioned SQL, no live migration.

## Technical context

Reuse the receipt builder and existing PostgreSQL work store and transaction lock. A chain is scoped to provider, source scope, task and analysis version.

## Open questions

Pending source custody, empty and removed work, real source authorization and transport remain separate.
