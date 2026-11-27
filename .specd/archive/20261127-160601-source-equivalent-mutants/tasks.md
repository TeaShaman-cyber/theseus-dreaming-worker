# Tasks: source-equivalent-mutants

## 1. Classify and verify

- [x] 1.1 Isolate exact redundant mutations without removing runtime checks.
      src/dreaming/source-batch-run.ts, src/dreaming/source-cycle.ts
      (Req: Pooled batch orchestration preserves source boundary)
- [x] 1.2 Verify mutation inventory and focused regressions.
      test/source-batch-run.test.mjs, test/source-cycle.test.mjs
      (Req: Bounded synthetic source batch run)
