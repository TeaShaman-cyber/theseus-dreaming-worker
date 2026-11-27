# Tasks: pooled-source-cycle

## 1. Compose pooled cycle

- [x] 1.1 Reuse validated preflight and bounded execution policy.
      src/dreaming/source-cycle.ts, src/dreaming/source-batch-run.ts
      (Req: Explicit pooled synthetic source cycle)
- [x] 1.2 Verify cycle boundary and snapshot.
      test/source-cycle.test.mjs
      (Req: Explicit pooled synthetic source cycle)
- [x] 1.3 Verify actual durable cycle recovery.
      qa/postgres/work-atomicity-probe.mjs
      (Req: Explicit pooled synthetic source cycle)
