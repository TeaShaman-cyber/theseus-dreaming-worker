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
            ["git", "ls-files", "-z", "--", "src", "specs", "infra", ".specd/metadata", "specd.yaml"], cwd=ROOT)
        for name in filter(None, tracked.decode("utf-8").split("\0")):
            source = ROOT / name
            if source.is_symlink() or not source.is_file():
                raise RuntimeError(f"expected regular tracked source: {name}")
            target = workspace / name
            target.parent.mkdir(parents=True, exist_ok=True)
            shutil.copy2(source, target)
        subprocess.run(["git", "init", "-q"], cwd=workspace, check=True)

        def native(*args):
            return json.loads(subprocess.check_output(
                [str(CLI), "--config", "specd.yaml", *args, "--format", "json"],
                cwd=workspace, text=True, timeout=30))

        def graph(*args):
            return native("graph", *args)

        listed = native("specs", "list", "--metadata-status")
        specs = [spec for ws in listed["workspaces"] for spec in ws["specs"]]
        stale = [spec["path"] for spec in specs if spec.get("metadataStatus") != "fresh"]
        if stale:
            raise RuntimeError(f"missing or stale native metadata: {stale}")
        indexed = graph("index")
        if indexed["errors"] or indexed["filesIndexed"] == 0:
            raise RuntimeError(f"graph indexing incomplete: {indexed}")
        stats = graph("stats")
        expected_specs = len(list((workspace / "specs").rglob("spec.md")))
        if stats["specCount"] != expected_specs or expected_specs == 0 or stats["symbolCount"] == 0:
            raise RuntimeError(f"graph missing symbols or specifications: {stats}")
        if any(stats["relationCounts"].get(kind, 0) == 0 for kind in ("CALLS", "IMPORTS")):
            raise RuntimeError(f"graph missing code relations: {stats}")
        # The native graph currently emits spec-to-spec edges, not COVERS
        # edges from legacy implementation mappings. Verify those separately
        # against native symbol search, never claim that a link proves semantics.
        ids = {spec["path"] for spec in specs}
        edges = set()
        for spec_id in ids:
            workspace_id, relative = spec_id.split(":", 1)
            metadata = json.loads((workspace / ".specd/metadata" / workspace_id /
                                   relative / "metadata.json").read_text())
            dependencies = metadata.get("dependsOn", [])
            if len(dependencies) != len(set(dependencies)) or not set(dependencies) <= ids:
                raise RuntimeError(f"invalid native dependencies: {spec_id}")
            edges.update((spec_id, dep) for dep in dependencies)
            lock = workspace / "specs" / relative / "spec-lock.json"
            if lock.exists() and set(json.loads(lock.read_text())["dependsOn"]) != set(dependencies):
                raise RuntimeError(f"legacy dependency mapping disagrees with native metadata: {spec_id}")
        if stats["relationCounts"].get("DEPENDS_ON", 0) != len(edges) or not edges:
            raise RuntimeError(f"native graph dependency edges incomplete: {stats}")

        # Confirm the actual compiled transitive context, not just counts.
        root_id = "default:ledger/postgres-storage"
        expected = {root_id}
        while True:
            expanded = expected | {dep for source, dep in edges if source in expected}
            if expanded == expected:
                break
            expected = expanded
        context = native("specs", "context", root_id, "--follow-deps")
        if {item["spec"] for item in context["specs"]} != expected or context["warnings"]:
            raise RuntimeError(f"native storage context incomplete: {context['warnings']}")

        linked_symbols = set()
        for lock in (workspace / "specs").rglob("spec-lock.json"):
            for link in json.loads(lock.read_text())["implementation"]:
                namespace, relative = link["file"].split(":", 1)
                if namespace != "default" or not (workspace / relative).is_file():
                    raise RuntimeError(f"legacy implementation file missing: {link['file']}")
                linked_symbols.update((link["file"], symbol) for symbol in link["symbols"])
        for file, symbol in sorted(linked_symbols):
            result = graph("search", symbol, "--symbols", "--limit", "50")
            if not any(item["symbol"]["name"] == symbol and item["symbol"]["filePath"] == file
                       for item in result["symbols"]):
                raise RuntimeError(f"native graph cannot resolve linked symbol: {file}::{symbol}")
        print(f"SPECD_GRAPH_PASS files={stats['fileCount']} symbols={stats['symbolCount']} "
              f"specs={stats['specCount']} calls={stats['relationCounts']['CALLS']} "
              f"dependencies={len(edges)} linkedSymbols={len(linked_symbols)} "
              f"storageContext={len(expected)}")



if __name__ == "__main__":
    main()
