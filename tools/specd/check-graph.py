"""Exercise the pinned native graph on tracked source/specs in a disposable workspace."""
import json
from pathlib import Path
import shutil
import subprocess
import tempfile

ROOT = Path(__file__).resolve().parents[2]
CLI = ROOT / "tools/specd/node_modules/.bin/specd"


def main():
    with tempfile.TemporaryDirectory(prefix="dw-specd-graph-") as directory:
        workspace = Path(directory)
        tracked = subprocess.check_output(
            ["git", "ls-files", "-z", "--", "src", "specs", "infra", "specd.yaml"], cwd=ROOT)
        for name in filter(None, tracked.decode("utf-8").split("\0")):
            source = ROOT / name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError(f"expected regular tracked source: {name}")
            target = workspace / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)

        def graph(*args):
            return json.loads(subprocess.check_output(
                [str(CLI), "--config", "specd.yaml", "graph", *args, "--format", "json"],
                cwd=workspace, text=True, timeout=30))

        indexed = graph("index")
        if indexed["errors"] or indexed["filesIndexed"] == 0:
            raise RuntimeError(f"graph indexing incomplete: {indexed}")
        stats = graph("stats")
        expected_specs = len(list((workspace / "specs").rglob("spec.md")))
        if stats["specCount"] != expected_specs or expected_specs == 0 or stats["symbolCount"] == 0:
            raise RuntimeError(f"graph missing symbols or specifications: {stats}")
        if any(stats["relationCounts"].get(kind, 0) == 0 for kind in ("CALLS", "IMPORTS")):
            raise RuntimeError(f"graph missing code relations: {stats}")
        result = graph("search", "runPilot2", "--symbols")
        if not any(item["symbol"]["name"] == "runPilot2" and
                   item["symbol"]["filePath"] == "default:src/dreaming/pilot2-runner.ts"
                   for item in result["symbols"]):
            raise RuntimeError("graph cannot resolve the known Pilot 2 symbol")
        print(f"SPECD_GRAPH_PASS files={stats['fileCount']} symbols={stats['symbolCount']} "
              f"specs={stats['specCount']} calls={stats['relationCounts']['CALLS']}")


if __name__ == "__main__":
    main()
