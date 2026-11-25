# Tasks: source-handoff-decoder

## 1. Portable validation

- [x] 1.1 Reproduce missing decoder
      test/source-handoff.test.mjs — actual source fixture and invalid candidates.
      Approach: synthetic data and independently expected identities.
      (Req: Recovery handoff candidate validation)
- [x] 1.2 Implement validation
      src/dreaming/source-handoff.ts — strict schema, digest and semantic checks.
      Approach: existing Zod and SHA helper.
      (Req: Recovery handoff candidate validation)
- [x] 1.3 Verify and document
      docs/ledger-neon.md — limits and canonical QA.
      Approach: native lifecycle and hosted review.
      (Req: Recovery handoff candidate validation)
