# Tasks: source-pooled-admission

## 1. Bind source custody

- [x] 1.1 Exercise source binding in the existing journal transaction.
      src/dreaming/proposal-ledger-postgres.ts, test/proposal-ledger-postgres.test.mjs
      (Req: Same-plan pooled source admission)
- [x] 1.2 Compose exact selected-session input and immutable origin.
      src/dreaming/source-batch-postgres.ts
      (Req: Same-plan pooled source admission)
- [x] 1.3 Verify actual PostgreSQL admission, recovery and acknowledgement.
      qa/postgres/work-atomicity-probe.mjs
      (Req: Same-plan pooled source admission)
