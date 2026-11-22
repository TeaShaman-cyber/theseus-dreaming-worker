from pathlib import Path
import unittest

ROOT = Path(__file__).resolve().parents[1]

class ReviewGateWorkflowContractTests(unittest.TestCase):
    def test_workflow_is_base_owned_and_never_executes_pr_head_code(self):
        workflow = (ROOT / '.github/workflows/review-gate.yml').read_text()
        self.assertIn('pull_request_target:', workflow)
        self.assertIn('types: [opened, synchronize, reopened, edited]', workflow)
        self.assertIn('github.event.pull_request.base.sha', workflow)
        self.assertNotIn('ref: ${{ github.event.pull_request.head.sha }}', workflow)
        self.assertIn('persist-credentials: false', workflow)
        self.assertIn('contents: read', workflow)
        self.assertNotIn('contents: write', workflow)

    def test_classifier_reads_changed_files_as_data_via_github_api(self):
        workflow = (ROOT / '.github/workflows/review-gate.yml').read_text()
        self.assertIn('/pulls/$PR_NUMBER/files?per_page=100', workflow)
        self.assertIn('/pulls/$PR_NUMBER', workflow)
        self.assertIn('scripts/codex_review_changed_files.py', workflow)
        self.assertIn('--expected-count', workflow)
        self.assertIn('python3 -I -', workflow)
        self.assertIn('scripts/review_gate_required.py --nul', workflow)
        self.assertNotIn('git diff --no-renames', workflow)

    def test_protected_review_is_observed_but_not_a_merge_authority(self):
        workflow = (ROOT / '.github/workflows/review-gate.yml').read_text()
        self.assertIn('tools/pr/codex-review-wait.sh', workflow)
        self.assertIn('github.event.pull_request.head.sha', workflow)
        self.assertIn("CLEAN)", workflow)
        self.assertIn("PASS: exact-head Codex review completed clean.", workflow)
        self.assertIn('UNAVAILABLE_QUOTA)', workflow)
        self.assertIn('Codex review debt remains', workflow)
        self.assertIn('Codex findings require explicit adjudication', workflow)
        self.assertNotIn('Exact-head Codex review has unresolved findings.\n              exit 1', workflow)
        self.assertNotIn('Codex review did not reach a terminal exact-head state', workflow)

if __name__ == '__main__':
    unittest.main()
