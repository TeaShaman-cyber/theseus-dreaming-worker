# Design: pooled-durable-execution

## Non-goals

No scheduler service, live deployment, paid route, hidden retries, source checkpoint change or new quality assessment.

## Affected areas

- `src/dreaming/pooled-durable-pilot2.ts` — composition and exact completion builder.
- `src/dreaming/pool-attempt-journal.ts` — known response evidence and duplicate-proposal rejection.
- `test/pooled-durable-pilot2.test.mjs` — bounded transition tests.
- `qa/postgres/pool-attempt-journal.mjs` — actual PostgreSQL recovery scenario.

## Approach

Freeze explicit route metadata, call selector with journal observations and invocation/lifetime budgets. Confirm START CAS plus readback before calling the existing Pilot 1 inference function exactly once. Only validated stop responses with matching model identity freeze a slot. Known provider errors or known invalid artifacts are recorded; unknown errors block. Use provider-wide cooldown when scope is unknown, and block that provider for this work when refusal or absent rate-limit wait cannot be safely bounded. Keep per-response metadata separate from configured identity. Complete using existing projection validation and recovery with the immutable final journal tip as pooled result fingerprint. Completed replay requires exact verified completion, and a pooled journal must agree with it. No raw output or reasoning retention. Caller supplies admitted bounded adapters, clock, task class and cross-work cooldowns; no implicit production route.

## Testing

Actual Pilot 1 validation over synthetic callbacks; 429 then restart and replacement, zero-call completed replay, unknown timeout and lost start/outcome acknowledgement, no-data and finite budgets. Existing PostgreSQL and repository QA.

## Spec impact

Additive explicit pooled executor; existing fixed-pair path and source cursor untouched.
