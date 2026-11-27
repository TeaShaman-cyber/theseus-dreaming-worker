# Tasks: pool-completion-custody

## 1. Complete only exact custody
- [x] 1.1 Add regression checks for ordinary and pooled write boundaries.
      test/durable-pilot2.test.mjs, test/proposal-ledger-postgres.test.mjs
      (Req: Pooled completion custody)
- [x] 1.2 Reuse deterministic builder under transaction lock.
      src/dreaming/proposal-ledger-postgres.ts, src/dreaming/pool-completion.ts, src/dreaming/pooled-durable-pilot2.ts
      (Req: Pooled completion custody)
- [x] 1.3 Verify on isolated PostgreSQL.
      qa/postgres/pool-attempt-journal.mjs
      (Req: Pooled completion custody)
