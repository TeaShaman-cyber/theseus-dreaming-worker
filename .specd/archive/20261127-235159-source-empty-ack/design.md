# Design: source-empty-ack

## Non-goals

No automatic empty-cycle ack, source completeness assertion, real data, new schema or permissions.

## Affected areas

- `src/dreaming/source-batch-postgres.ts` — explicit no-work checkpoint and readback validation.
- `qa/postgres/source-empty-ack.mjs` — PostgreSQL regression and negative controls.
- `qa/postgres/generate-source-empty-fixture.py` — actual pinned synthetic producer fixture.
- `tools/ci/heavy-postgres` — existing integration lane.

## Approach

Use existing strict handoff validation and explicit caller custody. Require changed membership, empty selection/removal, correct predecessor and absence of staged work under the same transaction lock. Reuse append and readChild exact readback, distinct versioned receipt with handoff and reason. Existing cycle returns NO_SELECTED_WORK, never writes. Readback validates the dedicated receipt shape and handoff. This does not independently authenticate producer identity or verify upstream freshness; caller owns those boundaries.

## Testing

Actual pinned producer recapture 7 to 11 accepted artifacts, zero semantic delta, verified bundles and simulated catalog. RED then GREEN real PostgreSQL; replay, concurrent conflict, pending plan and invalid witness controls, lost commit acknowledgement. Canonical QA.

## Spec impact

Explicit storage-only disposition for verified synthetic custody-only refresh, not a change to ordinary work completion.
