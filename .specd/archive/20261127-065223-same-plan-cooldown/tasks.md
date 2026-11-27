# Tasks: same-plan-cooldown

## 1. Share known restrictions

- [x] 1.1 Project finite same-plan deadlines and recheck under START lock.
      src/dreaming/source-batch-postgres.ts, src/dreaming/proposal-ledger-postgres.ts, test/proposal-ledger-postgres.test.mjs
      (Req: Same-plan finite provider cooldown)
- [x] 1.2 Preserve deferral and bounded selection.
      src/dreaming/pool-attempt-journal.ts, src/dreaming/pooled-durable-pilot2.ts, test/pooled-durable-pilot2.test.mjs
      (Req: Same-plan finite provider cooldown)
- [x] 1.3 Verify cross-work behavior and race in PostgreSQL.
      qa/postgres/work-atomicity-probe.mjs
      (Req: Same-plan finite provider cooldown)
