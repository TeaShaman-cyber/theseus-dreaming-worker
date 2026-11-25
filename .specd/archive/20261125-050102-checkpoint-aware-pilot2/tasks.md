# Tasks: checkpoint-aware-pilot2

## 1. Portable bounded checkpoint composition

- [x] 1.1 Reproduce missing checkpoint-aware admission
      test/checkpoint-pilot2.test.mjs — add no-call and terminal result tests.
      Approach: synthetic evidence and controlled adapters.
      (Req: Checkpoint-aware bounded execution skips unchanged work)
- [x] 1.2 Implement deterministic checkpoint composition
      src/dreaming/checkpoint-pilot2.ts — stable work identity, no-call states and terminal candidate.
      Approach: strict Zod, SHA256 and existing Pilot 2.
      (Req: Checkpoint-aware bounded execution skips unchanged work)
- [x] 1.3 Verify and document
      README.md, test/checkpoint-pilot2.test.mjs, tools/ci/mutation-test, scripts/mutation-shards.mjs, test/mutation-shards.test.mjs, .github/workflows/mutation.yml — document, wire hosted mutation and run QA.
      Approach: native lifecycle archive, required CI and review.
      (Req: Checkpoint-aware bounded execution skips unchanged work)
