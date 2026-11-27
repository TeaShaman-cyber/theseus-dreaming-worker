# Tasks: pooled-source-batch-run

## 1. Compose pooled batch

- [x] 1.1 Implement exact plan, budget and pending-outcome composition.
      src/dreaming/source-batch-run.ts
      (Req: Bounded pooled source batch)
- [x] 1.2 Verify deterministic batch contract.
      test/source-batch-run.test.mjs
      (Req: Bounded pooled source batch)
- [x] 1.3 Verify durable synthetic batch recovery in PostgreSQL.
      qa/postgres/work-atomicity-probe.mjs
      (Req: Bounded pooled source batch)
