# Tasks: hyperdrive-canary-build-pin

## 1. Reproducible synthetic QA

- [x] 1.1 Declare exact existing esbuild version and verify clean install/build.
      package.json, pnpm-lock.yaml
      (Req: QA layers)
- [x] 1.2 Reject invalid fixture cursors and test negative controls.
      qa/cloudflare/hyperdrive-canary.mjs, test/hyperdrive-canary.test.mjs
      (Req: QA layers)
- [x] 1.3 Record tested preview configuration and correct roadmap.
      qa/cloudflare/README.md, specs/README.md
      (Req: QA layers)
