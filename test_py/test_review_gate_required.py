import unittest

from scripts.review_gate_required import classify_paths, parse_paths


class ReviewGateRequiredTests(unittest.TestCase):
    def test_protected_paths_require_review(self):
        cases = [
            '.github/workflows/qa.yml',
            '.github/workflows/review-gate.yml',
            'tools/pr/codex-review-wait.sh',
            'scripts/codex_review_status.py',
            'scripts/review_gate_required.py',
            'scripts/verify-repo.mjs',
            'tools/dev/check',
            'tools/ci/mutation-test',
            'tools/agent/run-pilot1.mjs',
            'tools/reverse_trace/check_current.py',
            'docs/qa.md',
            'docs/observability.md',
            'AGENTS.md',
            'src/dreaming/pilot1-runner.ts',
            'src/dreaming/proposal-schema.ts',
            'src/mastra/gateways/exe-gateway.ts',
            'src/mastra/observability-routing.ts',
            'src/mastra/pilot1-tracing.ts',
            'src/mastra/index.ts',
            'config/agents/dreaming-worker-pilot1.json',
            'contracts/dreaming-worker.yaml',
            'contracts/dreaming-worker-invariants.json',
            'specs/pilot1/bounded-inference/spec.md',
            'specd.yaml',
            'package.json',
            'pnpm-workspace.yaml',
            'stryker.config.mjs',
        ]
        for path in cases:
            with self.subTest(path=path):
                result = classify_paths([path])
                self.assertTrue(result['required'])
                self.assertEqual(result['matches'][0]['path'], path)

    def test_ordinary_paths_do_not_require_review(self):
        result = classify_paths([
            'README.md',
            'docs/exe-dev-remote-mcp.md',
            'test/pilot1-runner.test.mjs',
            'test/proposal-schema.test.mjs',
            'fixtures/pilot1-timeout.json',
        ])
        self.assertFalse(result['required'])
        self.assertEqual(result['matches'], [])

    def test_any_protected_path_makes_mixed_diff_require_review(self):
        result = classify_paths(['README.md', 'tools/pr/codex-review-status.sh'])
        self.assertTrue(result['required'])
        self.assertEqual(len(result['matches']), 1)

    def test_paths_are_normalized_and_duplicates_are_collapsed(self):
        result = classify_paths([
            r'tools\pr\codex-review-status.sh',
            'tools/pr/codex-review-status.sh',
        ])
        self.assertTrue(result['required'])
        self.assertEqual(len(result['matches']), 1)


    def test_nul_delimited_paths_preserve_literal_protected_names(self):
        raw = (
            'src/dreaming/café.ts'.encode()
            + b'\0'
            + 'src/dreaming/tab\tname.ts'.encode()
            + b'\0'
            + 'src/dreaming/"quote".ts'.encode()
            + b'\0'
            + 'src/dreaming/trailing-space.ts '.encode()
            + b'\0'
        )
        paths = parse_paths(raw, nul_delimited=True)
        self.assertEqual(
            paths,
            [
                'src/dreaming/café.ts',
                'src/dreaming/tab\tname.ts',
                'src/dreaming/"quote".ts',
                'src/dreaming/trailing-space.ts ',
            ],
        )
        result = classify_paths(paths)
        self.assertTrue(result['required'])
        self.assertEqual(len(result['matches']), 4)

    def test_cloudflare_runtime_boundary_diff_requires_review(self):
        result = classify_paths([
            'docs/cloudflare-runtime.md',
            'src/runtime/cloudflare-pilot1-boundary.ts',
            'src/runtime/cloudflare-worker.ts',
            'test/cloudflare-pilot1-boundary.test.mjs',
        ])
        self.assertTrue(result['required'])
        self.assertEqual(
            [match['path'] for match in result['matches']],
            [
                'src/runtime/cloudflare-pilot1-boundary.ts',
                'src/runtime/cloudflare-worker.ts',
            ],
        )

    def test_empty_diff_does_not_require_review(self):
        self.assertEqual(classify_paths([]), {'required': False, 'matches': []})


if __name__ == '__main__':
    unittest.main()
