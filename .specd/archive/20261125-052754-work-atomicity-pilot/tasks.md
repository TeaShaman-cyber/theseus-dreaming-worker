# Tasks: work-atomicity-pilot

## 1. Test the storage mechanism

- [x] 1.1 Add real SQL research fixture
      qa/postgres/work-atomicity-probe.sql — unique work reservation, completion ownership and membership FKs.
      Approach: disposable test database and existing role.
      (Req: Append behavior)
- [x] 1.2 Exercise atomicity and contention
      qa/postgres/work-atomicity-probe.mjs — concurrent contenders, rollback, owner mismatch, successful commit, replay and readback.
      Approach: real clients and synthetic proposal records.
      (Req: Append behavior)
- [x] 1.3 Wire and verify
      tools/ci/heavy-postgres — run on the existing hosted service; preserve current QA.
      Approach: syntax checks and native lifecycle; hosted outcome remains separately observed.
      (Req: QA layers)
