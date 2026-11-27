# Tasks: ledger-linear-graph-replay

## 1. Optimize historical graph verification

- [x] 1.1 Add RED deterministic historical work and parity witnesses.
      test/proposal-ledger.test.mjs
      (Req: Supersession safety)
- [x] 1.2 Implement validated topological batch and safe candidate ranks.
      src/dreaming/proposal-ledger.ts, src/dreaming/proposal-ledger-postgres.ts
      (Req: Read behavior)
- [x] 1.3 Test corruption precedence, future append safety and rollback.
      test/proposal-ledger.test.mjs, test/proposal-ledger-postgres.test.mjs
      (Req: Append behavior)
