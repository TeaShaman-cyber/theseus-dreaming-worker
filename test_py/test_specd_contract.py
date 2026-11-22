from pathlib import Path
import json
import unittest

ROOT = Path(__file__).resolve().parents[1]
SPEC_DIR = ROOT / "specs" / "pilot1" / "bounded-inference"


class SpecDDurableContractTests(unittest.TestCase):
    def test_repository_uses_durable_filesystem_spec_workspace(self):
        config = (ROOT / "specd.yaml").read_text(encoding="utf-8")

        self.assertIn('schema: "@specd/schema-std"', config)
        self.assertIn("path: specs/", config)
        self.assertIn("path: .specd/changes/", config)
        self.assertIn("path: .specd/drafts/", config)
        self.assertIn("path: .specd/discarded/", config)
        self.assertIn("path: .specd/archive/", config)

    def test_pilot1_spec_lock_links_exact_stable_symbol(self):
        lock = json.loads((SPEC_DIR / "spec-lock.json").read_text(encoding="utf-8"))

        self.assertEqual(lock["schema"], {"name": "schema-std", "version": 1})
        self.assertEqual(lock["dependsOn"], [])
        self.assertEqual(
            lock["implementation"],
            [{
                "file": "default:src/dreaming/pilot1-runner.ts",
                "symbols": ["runPilot1"],
            }],
        )


    def test_pilot2_spec_lock_links_exact_stable_symbol(self):
        spec_dir = ROOT / "specs" / "pilot2" / "independent-perspectives"
        lock = json.loads((spec_dir / "spec-lock.json").read_text(encoding="utf-8"))

        self.assertEqual(lock["schema"], {"name": "schema-std", "version": 1})
        self.assertEqual(
            lock["dependsOn"],
            ["default:worker/core-contract", "default:pilot1/bounded-inference"],
        )
        self.assertEqual(
            lock["implementation"],
            [{
                "file": "default:src/dreaming/pilot2-runner.ts",
                "symbols": ["runPilot2"],
            }],
        )

    def test_pilot2_critique_spec_lock_links_only_deterministic_contract_symbols(self):
        spec_dir = ROOT / "specs" / "pilot2" / "critique-contract"
        lock = json.loads((spec_dir / "spec-lock.json").read_text(encoding="utf-8"))

        self.assertEqual(lock["schema"], {"name": "schema-std", "version": 1})
        self.assertEqual(
            lock["dependsOn"],
            ["default:pilot2/independent-perspectives", "default:worker/core-contract"],
        )
        self.assertEqual(
            lock["implementation"],
            [{
                "file": "default:src/dreaming/pilot2-critique.ts",
                "symbols": ["buildCritiqueInput", "parseCritiqueArtifact"],
            }],
        )

    def test_pilot2_live_composition_spec_lock_links_exact_stable_symbol(self):
        spec_dir = ROOT / "specs" / "pilot2" / "live-provider-composition"
        lock = json.loads((spec_dir / "spec-lock.json").read_text(encoding="utf-8"))

        self.assertEqual(lock["schema"], {"name": "schema-std", "version": 1})
        self.assertEqual(
            lock["dependsOn"],
            ["default:pilot2/independent-perspectives", "default:worker/core-contract"],
        )
        self.assertEqual(
            lock["implementation"],
            [{
                "file": "default:src/dreaming/pilot2-live-composition.ts",
                "symbols": ["runPilot2WithProviders"],
            }],
        )

    def test_spec_and_verify_preserve_bounded_inference_requirements(self):
        spec = (SPEC_DIR / "spec.md").read_text(encoding="utf-8")
        verify = (SPEC_DIR / "verify.md").read_text(encoding="utf-8")

        for phrase in [
            "External inference is scope-gated",
            "No accepted evidence means no model call",
            "bounded to one model inference",
            "no tool or memory operations",
            "Runtime receipt authority remains outside model prose",
        ]:
            self.assertIn(phrase, spec)

        for phrase in [
            "Unapproved scope is rejected before inference",
            "Pilot 0 reports NO_DATA",
            "Trace reports more than one inference",
            "Runtime trace reports a tool or memory operation",
            "Model prose lies about runtime counts",
        ]:
            self.assertIn(phrase, verify)

    def test_scoped_agents_bridge_routes_review_through_persisted_spec(self):
        agents = (ROOT / "src" / "dreaming" / "AGENTS.md").read_text(encoding="utf-8")

        self.assertIn("specs/**/spec-lock.json", agents)
        self.assertIn("spec.md", agents)
        self.assertIn("verify.md", agents)
        self.assertIn("does not", agents.lower())
        self.assertIn("proof", agents.lower())

    def test_local_override_is_not_canonical(self):
        ignore = (ROOT / ".gitignore").read_text(encoding="utf-8").splitlines()
        self.assertIn("specd.local.yaml", ignore)


if __name__ == "__main__":
    unittest.main()
