# Design: synthetic-source-cycle

## Non-goals

No live source reader, real-data egress, deployment, scheduler, new storage or removal acknowledgement.

## Affected areas

- `src/dreaming/source-cycle.ts` — portable composition and typed dispositions.
- `src/dreaming/source-batch-run.ts` — share existing execution policy validation and immutable route snapshot.
- `test/source-cycle.test.mjs` — preflight, failure and no-work controls.
- `qa/postgres/work-atomicity-probe.mjs` — actual bounded acquisition-to-ledger invocation.
- `docs/ledger-neon.md` — invocation and no-work semantics.
- `specs/intake/session-search-boundary/spec-lock.json` — exact symbol linkage.
- `test_py/test_agent_context_specs.py` — preserve synthetic-only link expectations.
- `.github/workflows/heavy-postgres.yml` — trigger existing contract for cycle changes.

## Approach

Snapshot the caller's acquisition input and limits, validate the handoff and synthetic scope, and validate the same execution policy used by the runner before reads. Retain a bounded metadata-only summary of candidate fingerprint, membership change, selected and removed counts and unknown source currentness. Empty selection with no extraneous indexes returns NO_SELECTED_WORK; any unresolved removal returns REMOVAL_PENDING. Both stop before transport or storage and never authorize acknowledgement. Invalid preflight returns INPUT_REJECTED. Complete acquisition delegates to existing runSourceBatch; acquisition failures become ACQUISITION_BLOCKED, no raw error payload. Return actual run disposition and receipt; unexpected execution exception remains unknown rather than claiming no calls. No default dependencies.

## Testing

RED missing entrypoint, then focused tests for invalid scope/policy, empty selection, removal and failed acquisition. Reuse existing PG18 contract for budget, continuation, exact replay and persisted receipt. No private inputs or external model calls.

## Spec impact

Add explicit bounded composition and verification without changing existing source custody or authority requirements.
