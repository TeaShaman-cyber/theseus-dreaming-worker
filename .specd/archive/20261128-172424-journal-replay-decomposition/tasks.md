# Tasks: journal-replay-decomposition

## 1. Preserve journal invariants

- [x] 1.1 Separate pure admission and validation checks; retain state transitions.
      src/dreaming/pool-attempt-journal.ts
      (Req: Bounded durable attempt journal)
- [x] 1.2 Verify behavior, complexity and canonical QA.
      src/dreaming/pool-attempt-journal.ts
      (Req: QA layers)
