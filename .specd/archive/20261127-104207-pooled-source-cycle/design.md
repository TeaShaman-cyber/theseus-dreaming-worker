# Design: pooled-source-cycle

## Non-goals

No unattended scheduling, real-source intake or new model permission.

## Affected areas

- `src/dreaming/source-cycle.ts` — share preflight, bounded acquisition and typed cycle outcome between explicit fixed-pair and pooled paths.
- `src/dreaming/source-batch-run.ts` — reuse pooled policy validation and immutable descriptor snapshot before acquisition.
- `test/source-cycle.test.mjs` — rejected policy, source failure, removal/no-work, pooled dispatch and snapshot isolation.
- `qa/postgres/work-atomicity-probe.mjs` — complete synthetic pooled cycle with bounded paginated source transport and actual durable recovery.

## Approach

Use one internal generic cycle composition receiving a prepared execution callback; preserve the existing fixed-pair call surface. Validate and snapshot policy before source transport. No inference or ledger operations on input rejection, empty selection, removal or acquisition failure. Delegate exact staged-plan custody, shared wait, budget and acknowledgement to the existing pooled batch runner. Preserve typed pending results and actual callback counts. Unknown exceptions remain explicit.

## Testing

Focused source cycle and batch tests, real isolated PostgreSQL with synthetic paginated acquisition, failure, restart, and zero-call replay. Existing fixed-pair regressions unchanged.

## Spec impact

Adds explicit pooled synthetic cycle only; all real source and deployment boundaries remain unchanged.
