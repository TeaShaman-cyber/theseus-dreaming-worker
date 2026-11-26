# Tasks: source-zero-pass-recovery

## 1. Recovery

- [x] 1.1 Reproduce completed-before-ack recovery with zero budget.
      test/source-batch-run.test.mjs
      (Req: Bounded synthetic source batch run)
- [x] 1.2 Reuse acknowledgement without inference.
      src/dreaming/source-batch-run.ts
      (Req: Bounded synthetic source batch run)
- [x] 1.3 Verify and document.
      qa/postgres/work-atomicity-probe.mjs, docs/ledger-neon.md
      (Req: Bounded synthetic source batch run)
