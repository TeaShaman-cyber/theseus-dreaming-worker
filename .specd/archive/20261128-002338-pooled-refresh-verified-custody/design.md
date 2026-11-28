# Design: pooled-refresh-completion

## Non-goals

No partial takeover, schema changes, real intake or deployment.

## Affected areas

- `src/dreaming/source-batch-postgres.ts` — explicit read-only completed alternative verification.
- `qa/postgres/work-atomicity-probe.mjs` — alternative completion and incomplete negative controls.
- `qa/pooled-native-refresh-probe.mjs` — pinned external synthetic handlers.

## Approach

Read committed completion and original plan only for a previously completed work. Verify current staged plan, reconstruct the original packet identity on equivalent evidence and validate the original request and evidence fingerprints. Replay the original journal and use the existing pooled runner's completion verification with read-only adapters. Any missing or conflicting observation fails closed. Keep ordinary same-plan execution unchanged.

## Testing

RED observed on isolated PG17. Repeat native probe and existing hosted PostgreSQL contract, plus canonical QA.

## Spec impact

Completed-work reuse only; original custody unchanged.

The storage rule explicitly preserves same-plan admission and permits only completed read-only reuse. Cheap origin existence probe and repeatable-read snapshot reject advanced predecessors.
