# Design: pooled-source-batch-run

## Non-goals

No global optimization, auto sleep/retry, cross-plan adoption, live acquisition, or changes to the fixed-pair path.

## Affected areas

- `src/dreaming/source-batch-run.ts` — shared exact receipt check and explicit pooled runner with bounded invocation budget and typed pending outcomes.
- `test/source-batch-run.test.mjs` — deterministic batch contract, budgets, replay, deferral, unknown and identity mismatch.
- `qa/postgres/work-atomicity-probe.mjs` — actual staged synthetic batch, partial restart and acknowledgement.

## Approach

Snapshot caller policy and validate descriptors with existing selector before store interaction. Bind execution to exact staged plan. Visit each selected work once, passing remaining batch invocation budget and rotation. Count actual inference callbacks and compare reported pass count. Completed work may consume zero calls on recovery; exact completion identity required. Known budget exhaustion, ineligibility and deferral may leave work pending and allow another selected work to be considered once. Unknown execution/storage, policy conflict, legacy reservation or invalid receipt stops the traversal. Acknowledge only when all selected completions are verified; exact already-acknowledged plan replays without inference. Return per-work outcome and earliest observed wake, not automatic scheduling.

## Testing

Unit contract and actual PG17 synthetic selected-session calls: first pass retained across budget exhaustion and 429, next invocation uses only remaining work, original source checkpoint unchanged until complete, exact replay zero calls; deferred work does not block independent eligible work and unknown stops.

## Spec impact

Add a bounded synthetic batch entry point without replacing existing fixed-pair source behavior.
