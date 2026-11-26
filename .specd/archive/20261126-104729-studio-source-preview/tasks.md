# Tasks: studio-source-preview

## 1. Development graph

- [x] 1.1 Reproduce missing graph and test fixed synthetic boundary.
      test/studio-source-preview.test.mjs
      (Req: Runtime, persistence, and authority remain separable)
- [x] 1.2 Register and implement preview.
      src/mastra/index.ts, src/mastra/workflows/source-batch-preview.ts
      (Req: Runtime, persistence, and authority remain separable)
- [x] 1.3 Run focused QA, document graph scope and verify registration.
      docs/studio-source-preview.md
      (Req: State claims are evidence-bound, not lexically inferred)
