# Design: journal-replay-decomposition

## Non-goals

Do not alter journal schema, error codes, event order, canonical fingerprints,
provider identity policy, or storage/dispatch authority. No artificial score gate.

## Affected areas

- `src/dreaming/pool-attempt-journal.ts` — separate admission and validated receipt checks from ordered replay.

## Approach

The replay loop owns state transitions; helpers validate one proposed START or
VALIDATED event using the current state. Preserve evaluation order and the
existing public API. The closed slot domain (0 or 1) and exact slot equality
already forbid a START after two validations. Preserve the existing diagnostic
and Unicode case semantics. Compare exact observed behavior using native tests
and independent journal replays; measure complexity with the existing analyzer.

## Evidence and testing

Baseline full journal mutation report: 141 killed, 101 compile errors,
3 survivors. Run focused tests, canonical QA, native SpecD diff verification
and exact-source mutation checks before acceptance. Compare per-function and
aggregate complexity, not just the maximum score.

## Spec impact

Native no-op delta for the existing bounded durable attempt journal requirement.
