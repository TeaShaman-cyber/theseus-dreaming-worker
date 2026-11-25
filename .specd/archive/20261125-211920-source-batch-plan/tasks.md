# Tasks: source-batch-plan

## 1. Pending custody

- [x] 1.1 Failing deterministic plan tests
      test/source-batch-receipt.test.mjs — metadata-only, stable work, distinct witnesses.
      (Req: Pending source plan custody)
- [x] 1.2 Implement portable plan and storage
      src/dreaming/source-batch-receipt.ts — reuse admission.
      src/dreaming/source-batch-postgres.ts — stage/read exact metadata.
      (Req: Pending source plan custody)
- [x] 1.3 Verify and document
      qa/postgres/work-atomicity-probe.mjs — hosted real PostgreSQL acceptance.
      (Req: Pending source plan custody)

Local fast tests and typecheck passed. Hosted PostgreSQL and exact-head
review are acceptance gates; the generation-change scenario remains
open and is not claimed as executed.
