# Tasks: pooled-refresh-completion

## 1. Verify completed alternative custody

- [x] 1.1 Verify original completion and journal without dispatch.
      src/dreaming/source-batch-postgres.ts
      (Req: Completed pooled work reuse across source witnesses)
- [x] 1.2 Verify cross-generation reuse and unchanged negative controls.
      qa/postgres/work-atomicity-probe.mjs, qa/pooled-native-refresh-probe.mjs
      (Req: Completed pooled work reuse across source witnesses)

## 2. Verify storage custody

- [x] 2.1 Verify original plan, original journal and committed projection using read-only adapters; reject corrupt, unstaged and stale alternative custody.
      src/dreaming/source-batch-postgres.ts, qa/postgres/work-atomicity-probe.mjs
      (Req: Read-only completed pooled reuse)
