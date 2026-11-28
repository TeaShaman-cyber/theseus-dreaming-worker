# Tasks: source-empty-ack

## 1. Confirm custody-only progress

- [x] 1.1 Add explicit validated append-only acknowledgement and readback.
      src/dreaming/source-batch-postgres.ts
      (Req: Explicit synthetic custody-only acknowledgement)
- [x] 1.2 Reproduce actual synthetic recapture and verify negative controls.
      qa/postgres/source-empty-ack.mjs, qa/postgres/generate-source-empty-fixture.py
      (Req: Explicit synthetic custody-only acknowledgement)
