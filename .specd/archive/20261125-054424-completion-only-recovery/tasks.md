# Tasks: completion-only-recovery

## 1. Recover retained completion

- [x] 1.1 Reproduce missing recovery
      test/durable-pilot2.test.mjs — explicit recovery without inference and fail-closed reads.
      Approach: deterministic fake store and exact candidate.
      (Req: Explicit completion-only recovery)
- [x] 1.2 Implement recovery
      src/dreaming/durable-pilot2.ts — validated envelope and one transaction with independent readback.
      Approach: reuse existing store and validator.
      (Req: Explicit completion-only recovery)
- [x] 1.3 Verify and document
      qa/postgres/work-atomicity-probe.mjs, docs/ledger-neon.md — actual PG rollback then recovery and limits.
      Approach: existing QA and native archive.
      (Req: Explicit completion-only recovery)
