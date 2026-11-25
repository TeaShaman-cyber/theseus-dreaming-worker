from pathlib import Path
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

    def test_future_specs_do_not_claim_implementation_links_yet(self):
        for rel in [
            "specs/worker/core-contract/spec-lock.json",
            "specs/intake/session-search-boundary/spec-lock.json",
        ]:
            with self.subTest(path=rel):
                self.assertFalse((ROOT / rel).exists())

    def test_spec_index_points_to_immediate_next_coding_task(self):
        index = (ROOT / "specs/README.md").read_text(encoding="utf-8")
        self.assertIn("Immediate next coding task", index)
        self.assertIn("pilot2/critique-contract", index)
        self.assertIn("bounded Dreaming Worker persistence call", index)
        self.assertIn("DERIVED_ONLY", index)
        self.assertIn("private Session Search intake", index)
        self.assertIn("Clef remains a separate", index)


if __name__ == "__main__":
    unittest.main()
