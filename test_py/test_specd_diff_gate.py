"""Regression against real Git history and an actual native archive."""
import os
from pathlib import Path
import shutil
import subprocess
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]


class DiffGateTests(unittest.TestCase):
    def test_protected_change_needs_fresh_native_coverage(self):
        with tempfile.TemporaryDirectory(prefix="dw-specd-diff-") as directory:
            repo = Path(directory)
            env = dict(os.environ, GIT_CONFIG_COUNT="2", GIT_CONFIG_KEY_0="user.name",
                       GIT_CONFIG_VALUE_0="SpecD test", GIT_CONFIG_KEY_1="user.email",
                       GIT_CONFIG_VALUE_1="specd-test@example.invalid")

            def run(*args, check=True, **kwargs):
                return subprocess.run(args, cwd=repo, env=env, check=check,
                                      capture_output=True, text=True, timeout=45, **kwargs)

            def commit(message):
                run("git", "add", "-A")
                run("git", "commit", "-qm", message)
                return run("git", "rev-parse", "HEAD").stdout.strip()

            run("git", "init", "-q")
            (repo / ".gitignore").write_text("node_modules\n.specd/config/\n")
            shutil.copy2(ROOT / "specd.yaml", repo)
            shutil.copytree(ROOT / "specs", repo / "specs")
            (repo / "src/dreaming").mkdir(parents=True)
            code = repo / "src/dreaming/probe.ts"
            code.write_text("export const probe = 1;\n")
            base = commit("base")
            code.write_text("export const probe = 2;\n")
            commit("uncovered runtime edit")

            (repo / "tools/specd").mkdir(parents=True)
            (repo / "tools/dev").mkdir(parents=True)
            shutil.copy2(ROOT / "tools/dev/specd-check", repo / "tools/dev")
            shutil.copy2(ROOT / "tools/specd/check-changes.py", repo / "tools/specd")
            checker = ROOT / "tools/specd/check-diff.py"
            shutil.copy2(checker, repo / "tools/specd")
            (repo / "tools/specd/node_modules").symlink_to(ROOT / "tools/specd/node_modules", target_is_directory=True)
            env["SPECD_DIFF_BASE"] = base
            result = run("sh", "tools/dev/specd-check", check=False)
            self.assertNotEqual(result.returncode, 0, result.stdout + result.stderr)
            self.assertIn("src/dreaming/probe.ts", result.stdout + result.stderr)

            # Create the coverage witness with the actual CLI, rather than
            # synthesizing a manifest or pretending a validation took place.
            cli = str(repo / "tools/specd/node_modules/.bin/specd")
            name = "probe-coverage"

            def native(*args):
                return run(cli, *args)

            native("changes", "create", name, "--spec", "default:worker/core-contract")
            change, = (repo / ".specd/changes").iterdir()
            (change / "proposal.md").write_text("""# Proposal: probe-coverage

## Motivation

Exercise the native coverage gate on an isolated synthetic runtime edit.

## Current behaviour

The synthetic probe exports one number.

## Proposed solution

Change the number and preserve the real native lifecycle witness.

## Specs affected

### New specs

None.

### Modified specs

- `default:worker/core-contract`: no requirement change.
  - Depends on (added): none

## Impact

One synthetic runtime path.

## Technical context

Native CLI regression fixture.

## Open questions

None.
""")
            native("changes", "validate", name, "--artifact", "proposal")
            native("changes", "transition", name, "designing")
            delta = change / "deltas/default/worker/core-contract"
            delta.mkdir(parents=True, exist_ok=True)
            for filename in ("spec.md.delta.yaml", "verify.md.delta.yaml"):
                (delta / filename).write_text("- op: no-op\n  description: Synthetic fixture only.\n")
            for artifact in ("specs", "verify"):
                native("changes", "validate", name, "--artifact", artifact, "--all")
            (change / "design.md").write_text("""# Design: probe-coverage

## Affected areas

- `src/dreaming/probe.ts` — synthetic runtime probe.

## Approach

Change the synthetic exported number.

## Testing

Inspect the committed synthetic source and exercise the native gate.
""")
            (change / "tasks.md").write_text("""# Tasks: probe-coverage

## 1. Synthetic runtime edit

- [ ] 1.1 Change the synthetic probe
      src/dreaming/probe.ts — update the exported number.
      Approach: change the fixture value.
      (Req: Deterministic sufficiency precedes additional model work)
""")
            for artifact in ("design", "tasks"):
                native("changes", "validate", name, "--artifact", artifact)
            for state in ("ready", "implementing"):
                native("changes", "transition", name, state)
            tasks = change / "tasks.md"
            tasks.write_text(tasks.read_text().replace("- [ ]", "- [x]"))
            native("changes", "validate", name, "--artifact", "tasks")
            for state in ("verifying", "done", "archivable"):
                native("changes", "transition", name, state)
            native("changes", "archive", name)
            archived, = (repo / ".specd/archive").glob("*/manifest.json")
            design = archived.parent / "design.md"
            covered = commit("native archive covers runtime edit")

            def gate(expected, message, base_sha=base):
                env["SPECD_DIFF_BASE"] = base_sha
                result = run("sh", "tools/dev/specd-check", check=False)
                self.assertEqual(result.returncode == 0, expected, result.stdout + result.stderr)
                self.assertIn(message, result.stdout + result.stderr)

            gate(True, "1 protected paths covered")
            # An unrelated second file is not covered merely by the presence
            # of a valid fresh native record.
            other = code.with_name("other.ts")
            other.write_text("export const other = 3;\n")
            commit("uncovered second path")
            gate(False, "src/dreaming/other.ts")
            run("git", "reset", "--hard", covered)

            design.write_text(design.read_text() + "\nUnvalidated text.\n")
            commit("drifted native archive")
            gate(False, "invalid native archive lifecycle")
            run("git", "reset", "--hard", covered)

            code.write_text("export const probe = 4;\n")
            commit("new edit with old archive")
            gate(False, "no fresh native archive", covered)
            run("git", "reset", "--hard", covered)

            # Even deleting a runtime file is a protected diff.
            code.unlink()
            commit("uncovered deletion")
            gate(False, "src/dreaming/probe.ts", covered)
            run("git", "reset", "--hard", covered)

            # Renames cover both endpoints, even when Git could detect a rename.
            renamed = code.with_name("renamed.ts")
            run("git", "mv", str(code), str(renamed))
            commit("uncovered rename destination")
            gate(False, "src/dreaming/renamed.ts")
            run("git", "reset", "--hard", covered)

            # Moving an old archive to a fresh directory does not renew its identity.
            run("git", "mv", str(archived.parent), str(archived.parent.with_name("replayed-probe")))
            code.write_text("export const probe = 5;\n")
            commit("replayed native change identity")
            gate(False, "reused native change identity", covered)
            run("git", "reset", "--hard", covered)

            (repo / "tsconfig.json").write_text("{}\n")
            commit("uncovered build configuration")
            gate(False, "tsconfig.json", covered)
            run("git", "reset", "--hard", covered)

            (repo / "README.md").write_text("Synthetic docs.\n")
            commit("documentation only")
            gate(True, "no protected runtime paths", covered)


if __name__ == "__main__":
    unittest.main()
