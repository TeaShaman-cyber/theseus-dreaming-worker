# Design: synthetic-cycle-inspection

## Non-goals

No live source access, new grants, dispatch, repair, scheduling or deployment.

## Affected areas

- `tools/agent/inspect-source-cycle.mjs` — explicit read-only diagnostic and thin CLI.
- `test/source-cycle-inspection.test.mjs` — synthetic readback and negative controls.
- `qa/postgres/source-process-loss.mjs` — use the diagnostic over actual interrupted process fixtures.
- `docs/qa.md` — usage and non-atomic observation boundary.

## Approach

Validate supplied synthetic batch with existing preparation. Read tip and exact staged plan independently. For each prepared work read verified completion and journal separately, compare journal-derived completion when available. Return only fingerprints, observed status and bounded counts. Keep missing, inconsistent and failed reads distinct. No mutation adapter is accepted by the diagnostic. The CLI uses an explicit existing database connection, without implicit initialization.

## Testing

Focused synthetic reader tests and existing isolated PostgreSQL process-loss fixture; canonical QA.

## Spec impact

Adds a read-only operator diagnostic, no change to execution or authority.
