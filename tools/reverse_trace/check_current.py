#!/usr/bin/env python3
from pathlib import Path
import json
import sys

ROOT = Path(__file__).resolve().parents[2]
sys.path.insert(0, str(ROOT / "tools" / "reverse_trace"))

from reverse_trace_contract import load_contract, validate_contract, evaluate_proof_witnesses

contract_path = ROOT / "contracts" / "dreaming-worker-invariants.json"
document = load_contract(contract_path)
errors = validate_contract(document)
if errors:
    for error in errors:
        print(f"REVERSE_TRACE_CONTRACT_ERROR: {error}", file=sys.stderr)
    raise SystemExit(1)

files = {}
for invariant in document["invariants"]:
    for item in invariant.get("evidence", []):
        if item.get("kind") in {"code", "test", "doc", "workflow"}:
            ref = item["ref"]
            path = ROOT / ref
            if path.is_file():
                files[ref] = path.read_text(encoding="utf-8")
    for check in invariant.get("proof_checks", []):
        ref = check["ref"]
        path = ROOT / ref
        if path.is_file():
            files[ref] = path.read_text(encoding="utf-8")

witnesses = evaluate_proof_witnesses(document, files)
missing = [item for item in witnesses if item["witness_status"] == "DECLARED_WITNESS_MISSING"]
summary = {
    "schema": "theseus.dreaming-worker.reverse-trace-check.v1",
    "invariantCount": len(document["invariants"]),
    "declaredWitnessesPresent": sum(item["witness_status"] == "DECLARED_WITNESSES_PRESENT" for item in witnesses),
    "semanticReviewRequired": sum(item["witness_status"] == "NO_DECLARED_MACHINE_WITNESS" for item in witnesses),
    "missingWitnesses": len(missing),
}
print(json.dumps(summary, sort_keys=True))

if missing:
    for item in missing:
        print(json.dumps(item, sort_keys=True), file=sys.stderr)
    raise SystemExit(1)

print("REVERSE_TRACE_CURRENT_PASS")
