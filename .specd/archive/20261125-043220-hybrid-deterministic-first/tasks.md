# Tasks: hybrid-deterministic-first

## 1. Policy and verification

- [x] 1.1 Align goal and review context with the requirement
      contracts/dreaming-worker.yaml, AGENTS.md, src/dreaming/AGENTS.md, docs/qa.md — clarify deterministic-first and requirement-linked acceptance.
      Approach: retain existing boundaries; use native compiled context for durable semantic changes.
      (Req: Deterministic sufficiency precedes additional model work)
- [x] 1.2 Validate active change artifacts in canonical QA
      tools/dev/specd-check, test_py/test_specd_gate.py — inspect native change status in an isolated snapshot and prove failures block QA.
      Approach: list active changes using the pinned CLI, reject lifecycle blockers or incomplete/drifted artifacts; fail on invalid output or nonzero exit. Explicit validation remains a developer action.
      (Req: Deterministic sufficiency precedes additional model work)
- [x] 1.3 Verify present recovery witnesses and native lifecycle
      tools/check_goal_contract.py, test/pilot1-runner.test.mjs, test/pilot2-runner.test.mjs, test/serializer-benchmark-runner.test.mjs — run existing tests, record scope and remaining #54 research.
      Approach: verify present deterministic behavior and rejection, never claim unimplemented recovery.
      (Req: Deterministic sufficiency precedes additional model work)
