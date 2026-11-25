"""A real native SpecD draft must not pass canonical QA."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class SpecDChangeGateTests(unittest.TestCase):
    def test_unvalidated_native_change_blocks_gate(self):
        with tempfile.TemporaryDirectory(prefix="dw-specd-change-") as directory:
            workspace = Path(directory)
            subprocess.run(["git", "init", "-q", str(workspace)], check=True)
            shutil.copy2(ROOT / "specd.yaml", workspace)
            shutil.copytree(ROOT / "specs", workspace / "specs")
            (workspace / "tools/dev").mkdir(parents=True)
            (workspace / "tools/specd").mkdir()
            shutil.copy2(ROOT / "tools/dev/specd-check", workspace / "tools/dev")
            checker = ROOT / "tools/specd/check-changes.py"
            shutil.copy2(checker, workspace / "tools/specd")
            (workspace / "tools/specd/node_modules").symlink_to(ROOT / "tools/specd/node_modules", target_is_directory=True)
            env = dict(os.environ, GIT_CONFIG_COUNT="2", GIT_CONFIG_KEY_0="user.name",
                       GIT_CONFIG_VALUE_0="SpecD test", GIT_CONFIG_KEY_1="user.email",
                       GIT_CONFIG_VALUE_1="specd-test@example.invalid")
            cli = workspace / "tools/specd/node_modules/.bin/specd"
            subprocess.run([str(cli), "changes", "create", "unvalidated-probe", "--spec",
                            "default:worker/core-contract"], cwd=workspace, env=env,
                           check=True, capture_output=True, timeout=30)
            manifests = list((workspace / ".specd/changes").glob("*/manifest.json"))
            self.assertEqual(len(manifests), 1)
            before = manifests[0].read_bytes()
            result = subprocess.run(["sh", "tools/dev/specd-check"], cwd=workspace,
                                    capture_output=True, text=True, timeout=30)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("unvalidated-probe", result.stdout + result.stderr)
            self.assertEqual(before, manifests[0].read_bytes())


if __name__ == "__main__":
    unittest.main()
