# Tasks: durable-pilot2-composition

## 1. Compose durable work

- [x] 1.1 Admission and projection
      src/dreaming/checkpoint-pilot2.ts, src/dreaming/durable-pilot2.ts, test/durable-pilot2.test.mjs — reserve before inference and preserve exact completion membership.
      Approach: existing deterministic identity and Pilot 2 runner.
      (Req: Work reservation and atomic completion)
- [x] 1.2 PostgreSQL adapter
      src/dreaming/proposal-ledger-postgres.ts, infra/postgres/dw_ledger_v1.sql, infra/postgres/verify_dw_ledger_v1.sql — real transactional storage and readback.
      Approach: reuse validated ledger insert; append-only unique reservations.
      (Req: Work reservation and atomic completion)
- [x] 1.3 Verification
      qa/postgres/work-atomicity-probe.mjs, scripts/mutation-shards.mjs, test/mutation-shards.test.mjs, docs/ledger-neon.md — real database and targeted regression.
      Approach: native lifecycle and hosted QA.
      (Req: QA layers)
