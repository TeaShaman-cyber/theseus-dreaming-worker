# Tasks: pooled-durable-execution

## 1. Bounded execution

- [x] 1.1 Exercise no-data, known and unknown outcomes with exact replay.
      test/pooled-durable-pilot2.test.mjs
      (Req: Explicit resumable pooled execution)
- [x] 1.2 Compose selection, journal and existing completion recovery.
      src/dreaming/pooled-durable-pilot2.ts, src/dreaming/pool-attempt-journal.ts
      (Req: Explicit resumable pooled execution)
- [x] 1.3 Verify isolated PostgreSQL completion and restart.
      qa/postgres/pool-attempt-journal.mjs
      (Req: Explicit resumable pooled execution)
