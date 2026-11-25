"""Exercise the actual upstream structural gate, not a mocked validator."""
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SpecDGateTests(unittest.TestCase):
    def test_invalid_spec_blocks_native_gate(self):
        with tempfile.TemporaryDirectory(prefix="dw-specd-gate-") as directory:
            workspace = Path(directory)
            subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)
            shutil.copy2(ROOT / "specd.yaml", workspace / "specd.yaml")
            shutil.copytree(ROOT / "specs", workspace / "specs")
            (workspace / "tools/dev").mkdir(parents=True)
            (workspace / "tools/specd").mkdir()
            shutil.copy2(ROOT / "tools/dev/specd-check", workspace / "tools/dev/specd-check")
            (workspace / "tools/specd/node_modules").symlink_to(
                ROOT / "tools/specd/node_modules", target_is_directory=True
            )

            def run_gate():
                return subprocess.run(
                    ["sh", "tools/dev/specd-check"], cwd=workspace,
                    capture_output=True, text=True, timeout=30,
                )

            valid = run_gate()
            self.assertEqual(valid.returncode, 0, valid.stdout + valid.stderr)
            spec = workspace / "specs/worker/core-contract/spec.md"
            content = spec.read_text(encoding="utf-8")
            self.assertIn("## Requirements\n", content)
            spec.write_text(content.replace("## Requirements\n", "## Broken heading\n", 1), encoding="utf-8")
            invalid = run_gate()
            self.assertEqual(invalid.returncode, 1, invalid.stdout + invalid.stderr)
            self.assertIn("default:worker/core-contract", invalid.stdout + invalid.stderr)
            spec.write_text(content, encoding="utf-8")
            (workspace / "tools/specd/node_modules").unlink()
            missing = run_gate()
            self.assertNotEqual(missing.returncode, 0)
            self.assertIn("SpecD QA toolchain missing", missing.stderr)


if __name__ == "__main__":
    unittest.main()
