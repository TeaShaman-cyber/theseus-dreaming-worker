# Tasks: strict-model-json

## 1. Strict model artifact boundary

- [x] 1.1 Reproduce ambiguous decoded keys in both artifact parsers.
      test/proposal-schema.test.mjs, test/pilot2-critique.test.mjs
      (Req: Model output is untrusted data)
- [x] 1.2 Integrate pinned strict parser, preserve classification and schema.
      src/dreaming/strict-model-json.ts, src/dreaming/proposal-schema.ts, src/dreaming/pilot2-critique.ts, package.json, pnpm-lock.yaml
      (Req: Model output is untrusted data)
- [x] 1.3 Verify regression and portable runtime QA.
      test/proposal-schema.test.mjs, test/pilot2-critique.test.mjs
      (Req: Runtime, persistence, and authority remain separable)
