"""Require fresh, intact native SpecD archive coverage for runtime Git changes."""
import json
import os
from pathlib import Path, PurePosixPath
import re
import shutil
import subprocess
import sys
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "tools/specd/node_modules/.bin/specd"
ARCHIVE = ".specd/archive/"
PREFIXES = ("src/", "tools/agent/", "tools/cloudflare/", "config/", "infra/")
EXACT = {"cloudflare.config.ts", "vite.config.ts", "package.json", "pnpm-lock.yaml",
         "pnpm-workspace.yaml", "tsconfig.json", "tools/run-pilot0.mjs",
         "tools/patch_mcp_gate_path.py"}


def git(*args):
    return subprocess.check_output(["git", *args], cwd=ROOT, timeout=30)


def protected(path):
    return path in EXACT or (path.startswith(PREFIXES) and PurePosixPath(path).name not in {"AGENTS.md", "README.md"})


def tree(commit, *paths):
    result = {}
    for entry in git("ls-tree", "-r", "-z", commit, "--", *paths).split(b"\0"):
        if entry:
            meta, path = entry.split(b"\t", 1)
            mode, kind, oid = meta.decode("ascii").split()
            result[os.fsdecode(path)] = (mode, kind, oid)
    return result


def archive_dirs(entries):
    return {path[len(ARCHIVE):].split("/", 1)[0] for path in entries
            if path.startswith(ARCHIVE) and "/" in path[len(ARCHIVE):]}


def materialize(snapshot, entries):
    for name, (mode, kind, oid) in entries.items():
        path = PurePosixPath(name)
        if path.is_absolute() or ".." in path.parts or kind != "blob" or mode not in {"100644", "100755"}:
            raise ValueError(f"unsafe snapshot entry: {name}")
        target = snapshot / name
        target.parent.mkdir(parents=True, exist_ok=True)
        target.write_bytes(git("cat-file", "blob", oid))


def design_paths(text):
    affected = False
    result = set()
    for line in text.splitlines():
        if line.startswith("## "):
            affected = line == "## Affected areas"
        elif affected:
            match = re.match(r"^- `([^`]+)`(?:\s|$)", line)
            if match:
                result.add(match[1])
    return result


def main(base):
    if not re.fullmatch(r"[0-9a-f]{40}", base):
        raise ValueError("expected exact Git base SHA")
    head = git("rev-parse", "HEAD").decode().strip()
    subprocess.run(["git", "merge-base", "--is-ancestor", base, head],
                   cwd=ROOT, check=True, timeout=15)
    changed = {os.fsdecode(p) for p in git("diff", "--name-only", "--no-renames", "-z", base, head, "--").split(b"\0") if p}
    required = {path for path in changed if protected(path)}
    if not required:
        print("SpecD diff coverage: no protected runtime paths")
        return

    base_entries = tree(base, ARCHIVE, "specs")
    old = archive_dirs(base_entries)
    old_names = {json.loads(git("cat-file", "blob", entry[2]))["name"]
                 for path, entry in base_entries.items()
                 if path.startswith(ARCHIVE) and path.endswith("/manifest.json")}
    entries = tree(head, "specd.yaml", "specs", ARCHIVE)
    fresh = archive_dirs(entries) - old
    if not fresh:
        raise ValueError("no fresh native archive for: " + ", ".join(sorted(required)))

    # Use exact committed bytes, not an editable working copy. Native status
    # can mutate manifests while detecting drift, so run on disposable data.
    with tempfile.TemporaryDirectory(prefix="dw-specd-diff-") as directory:
        snapshot = Path(directory)
        materialize(snapshot, entries)
        env = dict(os.environ, GIT_CONFIG_COUNT="2",
                   GIT_CONFIG_KEY_0="user.name", GIT_CONFIG_VALUE_0="SpecD QA",
                   GIT_CONFIG_KEY_1="user.email", GIT_CONFIG_VALUE_1="specd-qa@example.invalid")
        subprocess.run(["git", "init", "-q", str(snapshot)], check=True, env=env)

        def native(*args):
            return json.loads(subprocess.check_output(
                [str(CLI), "--config", "specd.yaml", *args, "--format", "json"],
                cwd=snapshot, env=env, text=True, timeout=30))

        specs = {s["path"] for w in native("specs", "list")["workspaces"] for s in w["specs"]}
        covered = set()
        seen_names = set()
        linked_by_path = {}
        # Preserve links from either exact tree, including removed links.
        for source in (base_entries, entries):
            for lock, entry in source.items():
                if not lock.startswith("specs/") or not lock.endswith("/spec-lock.json"):
                    continue
                if entry[0] not in {"100644", "100755"}:
                    raise ValueError(f"unsafe native spec link: {lock}")
                data = json.loads(git("cat-file", "blob", entry[2]))
                spec_id = "default:" + lock[len("specs/"):-len("/spec-lock.json")]
                for item in data.get("implementation", []):
                    file = item.get("file", "")
                    if file.startswith("default:"):
                        linked_by_path.setdefault(file[len("default:"):], set()).add(spec_id)
        for folder in sorted(fresh):
            archive = snapshot / ARCHIVE / folder
            manifest = json.loads((archive / "manifest.json").read_text())
            name = manifest["name"]
            if name in old_names or name in seen_names:
                raise ValueError(f"reused native change identity: {name}")
            seen_names.add(name)
            shown = native("archives", "show", name)
            scope = set(shown["specIds"])
            if (shown["name"] != name or shown["state"] != "archivable"
                    or not scope or not scope <= specs or scope != set(manifest["specIds"])):
                raise ValueError(f"invalid native archive scope: {folder}")
            active = snapshot / ".specd/changes" / folder
            active.parent.mkdir(parents=True, exist_ok=True)
            shutil.copytree(archive, active)
            status = native("changes", "status", name)
            shutil.rmtree(active)
            if (status.get("name") != name or status.get("state") != "archiving"
                    or status.get("blockers") != [] or status.get("review", {}).get("required") is not False
                    or not status.get("artifacts")
                    or any(a.get("effectiveStatus") not in {"complete", "skipped"} for a in status["artifacts"])
                    or not {"proposal", "specs", "verify", "design", "tasks"} <=
                    {a["type"] for a in status["artifacts"] if a.get("effectiveStatus") == "complete"}):
                raise ValueError(f"invalid native archive lifecycle: {name}; {status.get('blockers')}")
            paths = design_paths((archive / "design.md").read_text())
            # Existing native links can constrain an explicit design path.
            # Unlinked files still need a declared canonical spec and review.
            for path in required & paths:
                linked = linked_by_path.get(path, set())
                if not linked or linked & scope:
                    covered.add(path)
        missing = required - covered
        if missing:
            raise ValueError("no fresh validated design coverage for: " + ", ".join(sorted(missing)))
        print(f"SpecD diff coverage: {len(required)} protected paths covered by fresh native archives")


if __name__ == "__main__":
    try:
        if len(sys.argv) != 2:
            raise ValueError("usage: check-diff.py BASE_SHA")
        main(sys.argv[1])
    except (ValueError, KeyError, TypeError, OSError, subprocess.SubprocessError) as exc:
        raise SystemExit(f"SPECD_DIFF_GATE_FAIL: {exc}")
