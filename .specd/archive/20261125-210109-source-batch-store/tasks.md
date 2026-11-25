# Tasks: source-batch-store

## 1. Durable acknowledgement

- [x] 1.1 Add failing PostgreSQL integration contract
      qa/postgres/work-atomicity-probe.mjs — actual source adapter and work completions.
      (Req: Durable source batch acknowledgement)
- [x] 1.2 Implement append-only store
      src/dreaming/source-batch-postgres.ts — root, predecessor, verified successor and readback.
      (Req: Durable source batch acknowledgement)
- [x] 1.3 Verify and document
      infra/postgres/verify_dw_ledger_v1.sql — real constraints/grants and lifecycle.
      (Req: Durable source batch acknowledgement)
