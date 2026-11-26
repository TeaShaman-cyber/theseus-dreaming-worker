from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]


class AgentContextSpecTests(unittest.TestCase):
    def test_core_contract_preserves_agent_role_and_authority_boundary(self):
        spec = (ROOT / "specs/worker/core-contract/spec.md").read_text(encoding="utf-8")
        self.assertIn("not a search engine", spec)
        self.assertIn("not a general autonomous agent", spec)
        self.assertIn("Canonical promotion is outside the worker", spec)
        self.assertIn("Independent first passes remain independent", spec)

    def test_pilot2_is_the_next_bounded_implementation(self):
        spec = (ROOT / "specs/pilot2/independent-perspectives/spec.md").read_text(encoding="utf-8")
        self.assertIn("same evidence packet", spec)
        self.assertIn("different model-family identities", spec)
        self.assertIn("COMPLETE | PARTIAL | NO_DATA | FAIL_CLOSED", spec)
        self.assertIn("MUST NOT widen data egress", spec)
        self.assertIn("majority-vote truth", spec.lower())

    def test_real_session_search_intake_remains_deferred(self):
        spec = (ROOT / "specs/intake/session-search-boundary/spec.md").read_text(encoding="utf-8")
        self.assertIn("DEFERRED / UNKNOWN", spec)
        self.assertIn("query API", spec)
        self.assertIn("accepted-source delta feed", spec)
        self.assertIn("Read authority does not imply model-egress authority", spec)

    def test_synthetic_intake_links_do_not_claim_real_source_reader(self):
        self.assertFalse((ROOT / "specs/worker/core-contract/spec-lock.json").exists())
        lock = json.loads((ROOT / "specs/intake/session-search-boundary/spec-lock.json").read_text())
        self.assertEqual(lock["dependsOn"], ["default:worker/core-contract"])
        self.assertEqual({entry["file"]: entry["symbols"] for entry in lock["implementation"]}, {
            "default:src/dreaming/source-handoff.ts": ["decodeSourceHandoff"],
            "default:src/dreaming/verified-session-work.ts": ["prepareVerifiedSessionWork"],
            "default:src/dreaming/source-batch-receipt.ts": ["prepareSourceBatchExecution", "prepareSourceBatchReceipt"],
            "default:src/dreaming/checkpoint-pilot2.ts": ["prepareCheckpointedPilot2", "runCheckpointedPilot2"],
            "default:src/dreaming/source-batch-acquire.ts": ["acquireSourceBatch"],
            "default:src/dreaming/source-batch-run.ts": ["runSourceBatch"],
            "default:src/dreaming/source-cycle.ts": ["runSourceCycle"],
        })

    def test_spec_index_points_to_immediate_next_coding_task(self):
        index = (ROOT / "specs/README.md").read_text(encoding="utf-8")
        self.assertIn("Immediate next coding task", index)
        self.assertIn("pilot2/critique-contract", index)
        self.assertIn("separately authorized bounded persistence canary", index)
        self.assertIn("accepted in hosted PostgreSQL 18", index)
        self.assertIn("DERIVED_ONLY", index)
        self.assertIn("private Session Search intake", index)
        self.assertIn("Clef remains a separate", index)


if __name__ == "__main__":
    unittest.main()
