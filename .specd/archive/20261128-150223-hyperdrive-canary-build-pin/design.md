# Design: hyperdrive-canary-build-pin

## Non-goals

No production release, provider credentials, runtime dependency upgrades or weakened gates.

## Affected areas

- `package.json` — direct esbuild 0.28.2 development dependency.
- `pnpm-lock.yaml` — existing exact package version added to importer only.
- `qa/cloudflare/hyperdrive-canary.mjs` — fixture cursor validation.
- `test/hyperdrive-canary.test.mjs` — negative cursor/shard controls.
- `qa/cloudflare/README.md` — exact preview compatibility settings.
- `specs/README.md` — correct stale roadmap.

## Approach

Use exact existing lock entry, reject unknown cursor before computing next page, and document nodejs_compat with compatibility date 2026-11-22.

## Evidence and testing

Clean offline frozen pnpm 11 install and esbuild 0.28.2 build passed; two cursor regression tests RED then GREEN. Canonical QA 458 JS and 51 Python passed before main refresh. Actual edge preview on candidate 05b8b1f passed start/resume/replay with simulated calls 2/2/0 and independent Neon membership readback. Issue #23 receipt 7241137995. Hosted exact diff gate remains required.

## Spec impact

No-op delta; existing QA and storage contract preserved.
