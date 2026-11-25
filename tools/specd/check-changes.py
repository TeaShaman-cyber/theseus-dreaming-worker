"""Check native SpecD lifecycle evidence without rewriting the working tree."""
import json
import os
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "tools/specd/node_modules/.bin/specd"


def main():
    active = ROOT / ".specd/changes"
    if not active.exists():
        print("SpecD active changes: none")
        return
    with tempfile.TemporaryDirectory(prefix="dw-specd-status-") as directory:
        snapshot = Path(directory)
        shutil.copy2(ROOT / "specd.yaml", snapshot)
        shutil.copytree(ROOT / "specs", snapshot / "specs")
        shutil.copytree(active, snapshot / ".specd/changes")
        # Native status may persist drift events. Let it do so only here,
        # as a QA actor, not as a fabricated approval or original author.
        env = dict(os.environ, GIT_CONFIG_COUNT="2",
                   GIT_CONFIG_KEY_0="user.name", GIT_CONFIG_VALUE_0="SpecD QA",
                   GIT_CONFIG_KEY_1="user.email", GIT_CONFIG_VALUE_1="specd-qa@example.invalid")
        subprocess.run(["git", "init", "-q", str(snapshot)], check=True, env=env)

        def run(*args):
            return json.loads(subprocess.check_output(
                [str(CLI), "--config", "specd.yaml", *args, "--format", "json"],
                cwd=snapshot, env=env, text=True, timeout=30,
            ))

        changes = run("changes", "list")
        if not isinstance(changes, list):
            raise ValueError("unexpected native change list")
        names = [row["name"] for row in changes]
        if len(names) != len(set(names)):
            raise ValueError("ambiguous native change identity")
        # A manifest that native discovery cannot enumerate must not vanish
        # from the check. Do not interpret private sidecar fields.
        directories = [path for path in active.iterdir() if path.is_dir()]
        if len(directories) != len(names):
            raise ValueError("active directory/native change count mismatch")
        for name in names:
            status = run("changes", "status", name)
            if (
                status.get("name") != name
                or status.get("state") not in {"ready", "implementing", "verifying", "done", "archivable"}
                or status.get("blockers") != []
                or status.get("review", {}).get("required") is True
                or not status.get("artifacts")
                or any(a.get("effectiveStatus") not in {"complete", "skipped"}
                       for a in status["artifacts"])
            ):
                raise ValueError(f"SpecD active change {name}: {status.get('state')}, blockers={status.get('blockers')}")
        print(f"SpecD active changes: {len(names)} valid native lifecycle states")


if __name__ == "__main__":
    try:
        main()
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as exc:
        raise SystemExit(f"SPECD_CHANGE_GATE_FAIL: {exc}")
