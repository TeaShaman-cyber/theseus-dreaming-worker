# Design: strict-model-json

## Non-goals

No provider calls, semantic repair, production deployment, or generic source JSON migration.

## Affected areas

- `src/dreaming/strict-model-json.ts`
- `src/dreaming/proposal-schema.ts`
- `src/dreaming/pilot2-critique.ts`
- `package.json`
- `pnpm-lock.yaml`
- `test/proposal-schema.test.mjs`
- `test/pilot2-critique.test.mjs`

## Approach

One thin shared parser using exact pinned @prantlf/jsonlint with mode json and allowDuplicateObjectKeys false. Preserve native error classification at each caller, unchanged Zod schemas and provenance checks. No Python subprocess or handwritten grammar. Preserve legitimate distinct keys, including Unicode normalization differences.

## Testing

RED then GREEN on literal and decoded-equal duplicate fields in otherwise valid model artifacts, reuse upstream JSONTestSuite for parser qualification, existing bundled Studio and Cloudflare QA. Verify unchanged legitimate decoded values and no new inference.

## Spec impact

Enforce existing untrusted-data contract; no new authority or schema.
