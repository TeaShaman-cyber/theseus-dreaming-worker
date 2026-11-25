# Proposal: ledger-storage-acceptance

## Motivation

Issue #50 and PR #51 implement durable append-only storage but have not been accepted. Hosted mutation tests found 17 survivors. The current main additionally requires native SpecD lifecycle and exact runtime diff coverage.

## Current behaviour

The unmerged adapter uses fresh PostgreSQL clients, a transaction-scoped lock and validated append-only records. Existing database tests passed, but the mutation suite did not independently establish connection-string use, transaction entry and precise null-row diagnostics. Its original spec predates mandatory native validation.

## Proposed solution

Preserve the proposed adapter and existing database authority. Normalize its spec structure, correct the stale hosted PostgreSQL version label, strengthen the transaction/connection/diagnostic regression tests, and perform the actual native lifecycle now. No fabricated historical lifecycle.

## Specs affected

### New specs

None.

### Modified specs

- `default:ledger/postgres-storage`: existing proposed storage contract, with verification refined.
  - Depends on (added): none

## Impact

Existing PR51 storage and database QA only. No new production schema application, deployment, credentials, permissions or inference.

## Technical context

Base main contains the new SpecD gates. The exact pre-follow-up head is 67f6fb961d743c26989001677b3d785fc22ee4bf. The existing spec-lock links the storage adapter and DDL. Issue #65 depends on accepted storage.

## Open questions

Atomic multi-record checkpoint completion is separate #65; no design decision about that implementation here.
