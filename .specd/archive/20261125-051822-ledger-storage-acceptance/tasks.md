# Tasks: ledger-storage-acceptance

## 1. Complete existing storage acceptance

- [x] 1.1 Normalize existing proposed spec and merge current QA
      specs/ledger/postgres-storage/spec.md, specs/ledger/postgres-storage/verify.md, docs/qa.md — preserve normative semantics and repair headings.
      Approach: actual native validation, no invented historical archive.
      (Req: Connection boundary)
- [x] 1.2 Kill observed surviving mutations
      test/proposal-ledger-postgres.test.mjs — verify connection, null-field diagnostics and transaction order.
      Approach: actual pg client with controlled I/O, strict fake and exact mutant reproduction.
      (Req: Connection and transaction boundaries are independently verified)
- [x] 1.3 Verify and archive
      src/dreaming/proposal-ledger-postgres.ts, infra/postgres/dw_ledger_v1.sql, infra/postgres/verify_dw_ledger_v1.sql, package.json, pnpm-lock.yaml — existing PR51 implementation and dependencies covered by native change.
      Approach: canonical QA, actual native archive, hosted database and mutation checks.
      (Req: Append behavior)
