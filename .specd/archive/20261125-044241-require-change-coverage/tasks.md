# Tasks: require-change-coverage

## 1. Mandatory diff check

- [x] 1.1 Establish failing Git/native archive regression
      test_py/test_specd_diff_gate.py — exercise missing, stale, wrong-scope and drifted archive evidence.
      Approach: use actual Git trees and native SpecD status.
      (Req: Deterministic sufficiency precedes additional model work)
- [x] 1.2 Wire the diff check into existing QA
      tools/specd/check-diff.py, tools/dev/specd-check, .github/workflows/qa.yml, scripts/verify-repo.mjs — enforce fresh native scope evidence.
      Approach: explicit base, checked-out HEAD, native archive readback and status in disposable snapshot.
      (Req: Deterministic sufficiency precedes additional model work)
- [x] 1.3 Document and verify
      AGENTS.md, docs/qa.md — explain scope, no-op delta route and semantic review limit.
      Approach: local focused tests, native lifecycle archive and hosted QA.
      (Req: Deterministic sufficiency precedes additional model work)
