from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]


class ReviewGateWorkflowContractTests(unittest.TestCase):
    def test_workflow_uses_exact_head_review_helpers_and_base_classifier(self):
        workflow = (ROOT / '.github/workflows/review-gate.yml').read_text()

        self.assertIn('scripts/review_gate_required.py', workflow)
        self.assertIn('tools/pr/codex-review-wait.sh', workflow)
        self.assertIn('github.event.pull_request.head.sha', workflow)
        self.assertIn('github.event.pull_request.base.sha', workflow)
        self.assertIn('git show "$BASE_SHA:scripts/review_gate_required.py"', workflow)
        self.assertIn('base_has_gate', workflow)
        self.assertIn("github.event.pull_request.base.sha", workflow)
        self.assertIn("github.event.pull_request.head.sha", workflow)
        self.assertIn('BOOTSTRAP: base branch has no review helpers yet', workflow)
        self.assertIn('FINDINGS', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertIn('git diff --no-renames --name-only', workflow)

    def test_protected_review_accepts_only_exact_head_clean(self):
        workflow = (ROOT / '.github/workflows/review-gate.yml').read_text()

        self.assertIn("CLEAN) echo 'PASS: exact-head Codex review completed clean.'", workflow)
        self.assertIn('Exact-head Codex review has unresolved findings', workflow)
        self.assertIn('Codex review did not reach a terminal exact-head state', workflow)


if __name__ == '__main__':
    unittest.main()
