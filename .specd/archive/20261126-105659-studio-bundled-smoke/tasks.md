# Tasks: studio-bundled-smoke

## 1. Bundled runtime verification

- [x] 1.1 Reproduce failure in isolated actual Studio.
      tools/ci/build-check — existing build lacked this witness.
      (Req: State claims are evidence-bound, not lexically inferred)
- [x] 1.2 Bundle the fixed fixture and add HTTP regression.
      src/mastra/workflows/source-batch-preview.ts, tsconfig.json, tools/ci/studio-smoke.mjs
      (Req: Runtime, persistence, and authority remain separable)
- [x] 1.3 Verify and document.
      tools/ci/build-check, docs/studio-source-preview.md
      (Req: State claims are evidence-bound, not lexically inferred)
