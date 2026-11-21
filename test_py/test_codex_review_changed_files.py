import unittest

from scripts.codex_review_changed_files import extract_changed_paths


class ChangedFilesEvidenceTests(unittest.TestCase):
    def test_extracts_current_paths(self):
        paths = extract_changed_paths(
            [[
                {"filename": "README.md", "status": "modified"},
                {"filename": "src/dreaming/pilot1-runner.ts", "status": "modified"},
            ]],
            expected_count=2,
        )
        self.assertEqual(paths, ["README.md", "src/dreaming/pilot1-runner.ts"])

    def test_rename_includes_previous_and_destination_paths(self):
        paths = extract_changed_paths(
            [[{
                "filename": "docs/pilot1-runner.ts",
                "previous_filename": "src/dreaming/pilot1-runner.ts",
                "status": "renamed",
            }]],
            expected_count=1,
        )
        self.assertEqual(
            paths,
            ["src/dreaming/pilot1-runner.ts", "docs/pilot1-runner.ts"],
        )

    def test_malformed_file_entry_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "malformed pull files payload"):
            extract_changed_paths([[{"status": "modified"}]], expected_count=1)

    def test_incomplete_api_result_fails_closed(self):
        with self.assertRaisesRegex(ValueError, "incomplete pull files payload"):
            extract_changed_paths(
                [[{"filename": "README.md", "status": "modified"}]],
                expected_count=3001,
            )

    def test_expected_count_counts_file_entries_not_rename_paths(self):
        paths = extract_changed_paths(
            [[{
                "filename": "docs/new.ts",
                "previous_filename": "src/dreaming/old.ts",
                "status": "renamed",
            }]],
            expected_count=1,
        )
        self.assertEqual(len(paths), 2)


if __name__ == "__main__":
    unittest.main()
