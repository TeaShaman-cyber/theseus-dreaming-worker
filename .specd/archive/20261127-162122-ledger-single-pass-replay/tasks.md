# Tasks: ledger-single-pass-replay

## 1. Remove redundant replay

- [x] 1.1 Add deterministic work-bound and differential witnesses.
      test/proposal-ledger.test.mjs, test/proposal-ledger-postgres.test.mjs
      (Req: Append behavior)
- [x] 1.2 Implement and integrate transaction-local validated accumulator.
      src/dreaming/proposal-ledger.ts, src/dreaming/proposal-ledger-postgres.ts
      (Req: Content-addressed identity)
- [x] 1.3 Verify canonical QA, synthetic timing and storage integrity.
      test/proposal-ledger.test.mjs, test/proposal-ledger-postgres.test.mjs
      (Req: Read behavior)
