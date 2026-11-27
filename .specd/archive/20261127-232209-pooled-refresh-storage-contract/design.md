# Design: pooled-refresh-storage-contract

## Non-goals

No partial takeover, new grants or deployment.

## Affected areas

- `src/dreaming/source-batch-postgres.ts` — read-only original plan and journal verification on completed reuse.
- `qa/postgres/work-atomicity-probe.mjs` — real PostgreSQL negative controls.
- `qa/pooled-native-refresh-probe.mjs` — native handler fixture integration.

## Approach

The original #120 implementation verifies current and original plan identity, reconstructs original packet identity, replays original journal and compares the completion using the existing runner with write-denying adapters. This archive covers the linked storage specification, not a bypass of the diff gate.

## Testing

Actual PostgreSQL 17 RED/GREEN and full real PostgreSQL contract, exact committed diff coverage, hosted QA and review.

## Spec impact

Clarifies the distinction between read-only completion reuse and forbidden cross-plan journal adoption.
