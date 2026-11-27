# Tasks: pool-attempt-journal

## 1. Durable attempts

- [x] 1.1 Specify and test immutable attempt transition rules.
      src/dreaming/pool-attempt-journal.ts, test/pool-attempt-journal.test.mjs
      (Req: Bounded durable attempt journal)
- [x] 1.2 Add transactional storage and exact readback.
      src/dreaming/proposal-ledger-postgres.ts, infra/postgres/dw_ledger_v1.sql, infra/postgres/verify_dw_ledger_v1.sql
      (Req: Bounded durable attempt journal)
- [x] 1.3 Test real PostgreSQL restart, concurrency, unknown and grants.
      qa/postgres/pool-attempt-journal.mjs, tools/ci/heavy-postgres
      (Req: Bounded durable attempt journal)
