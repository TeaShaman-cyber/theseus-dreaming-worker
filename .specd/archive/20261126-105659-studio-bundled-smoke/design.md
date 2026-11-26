# Design: studio-bundled-smoke

## Non-goals

No production deployment, private evidence, provider calls or database connection.

## Affected areas

- `src/mastra/workflows/source-batch-preview.ts` — static synthetic JSON import, no runtime path.
- `tsconfig.json` — ESNext module syntax for import attributes; keep ES2022 target and noEmit.
- `tools/ci/build-check` — invoke local bundled workflow HTTP smoke.
- `tools/ci/studio-smoke.mjs` — start a short-lived built instance, inspect graph, execute and read back the fixed synthetic run.
- `docs/studio-source-preview.md` — document packaging and verification.

## Approach

Use the standard Node 22 JSON import attribute and compile without emitting JS. Mastra bundles the same checked-in fixture. Start the built entrypoint in its output directory with an isolated environment and local port; verify graph/schema, run fixed fixture, assert receipt candidate and zero external calls/no checkpoint advancement, read back run, clean up process. Do not alter existing live service.

## Testing

Observed RED: actual development server POST start-async returned failed at verify-source with ENOENT. Existing unit tests, typecheck and canonical build smoke must pass after correction.

## Spec impact

Development-only verification strengthens the existing separation of runtime and authority.
