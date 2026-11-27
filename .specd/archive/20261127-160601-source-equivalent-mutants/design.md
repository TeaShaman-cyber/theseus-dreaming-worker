# Design: source-equivalent-mutants

## Non-goals

No relaxed budget, receipt or plan checks, global mutation exclusions, threshold change, real-source operation or paid inference.

## Affected areas

- `src/dreaming/source-batch-run.ts` — isolate redundant boolean checks and validation-only constants.
- `src/dreaming/source-cycle.ts` — internal normalized error message classification.
- `test/source-batch-run.test.mjs` — existing positive and negative witnesses; retain exact boundary coverage.

## Approach

Staged plans are plain JSON-shaped store results: canonical full-plan digest includes the planFingerprint; explicit identity remains a defense against collisions, not an assumption of mathematically impossible collisions. Keep null guard and all digest and status checks. In pooled preflight the selector parses all schema fields before using unresolvedAttempt or remainingAttempts; with zero budget the selection result is discarded. The wrapper increments a private synchronous counter only when it is below budget; therefore used = attemptedPasses - before never exceeds budget - before. Keep its explicit bound as defense in depth. Cycle input rejection catches its own error and always returns the same normalized result. Narrow mutation comments by line and operator; inspect the generated mutant inventory and keep independent negative controls. No authorization or semantic requirement change.

## Testing

Exact hosted survivor list, focused regression tests and canonical QA; inspect actual ignored mutation replacements; full hosted matrix and exact-head review required before promotion.

## Spec impact

Existing source boundary, checkpoint and budget invariants remain unchanged.

### Exact mutation inventory

On hosted head e48959d, run 46022393994 reports 239 killed, 7 survived, 180 compile errors, zero uncovered and zero timeouts. Instrumenter 10.1.1 on this candidate reports 472 mutants across the two source files (426 batch, 46 cycle). Exactly six are ignored: two staged-plan fingerprint inequality to false replacements, attemptedRouteIds empty array to a valid nonempty array, unresolvedAttempt false to true, pooled redundant budget inequality to false and its subtraction to addition. The former combined fixed-stage condition is no longer ignored: all 19 newly shaped conditional/logical mutants were replayed directly and rejected by focused tests. No entire function or unrelated operator is excluded. Source cycle no longer constructs the unobservable error message. This classification assumes JSON-shaped store plans and SHA-256 collision resistance; explicit identity remains checked. Focused 34/34 pass. Full Stryker/TypeScript and hosted checks remain acceptance evidence, not implied by instrumentation.
