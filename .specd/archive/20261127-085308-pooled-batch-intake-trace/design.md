# Design: pooled-batch-intake-trace

## Non-goals

No additional runtime behavior, live source intake or weakening of the trace gate.

## Affected areas

- `src/dreaming/source-batch-run.ts` — explicit bounded pooled composition already implemented in 481d6ee.
- `test/source-batch-run.test.mjs` — exact bounded composition tests.
- `qa/postgres/work-atomicity-probe.mjs` — durable partial recovery test.

## Approach

Record intake-side orchestration invariant under the existing linked specification. Preserve the ledger requirement for durable custody. Correct the trace gap using the native lifecycle, not by rewriting historical archives.

## Testing

Existing focused tests and actual isolated PostgreSQL batch recovery pass. Re-run native diff coverage on exact committed tree and standard dev checks.

## Spec impact

Intake-side trace of the already implemented synthetic entry point.
