# Design: strict-critique-json

## Non-goals

No semantic change to critique, routing, provider or deployment.

## Affected areas

- `src/dreaming/pilot2-critique.ts` — use shared strict parser before existing validation.
- `test/pilot2-critique.test.mjs` — duplicate decoded key regression.

## Approach

Reuse the same pinned parser and shared module. Preserve CRITIQUE_JSON_INVALID, schema and exact frozen references.

## Testing

Existing RED/GREEN critique regression and full repository QA. No model calls.

## Spec impact

No change to the accepted critique schema or authority.
