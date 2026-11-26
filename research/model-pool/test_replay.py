import unittest
from unittest.mock import patch
import replay


class ReplayTest(unittest.TestCase):
    def setUp(self):
        self.family = {"a": "x", "b": "x", "c": "y", "d": "z"}
        self.models = sorted(self.family)
        self.stats = {(dim, m): (q, 1.) for dim in ("*", "task")
                      for m, q in zip(self.models, (.9, .85, .8, .6))}
        self.joint = {("task", a, b): .5 for a, b in
                      replay.itertools.combinations(self.models, 2)}
        self.data = {"t": ("task", {m: (1., 1.) for m in self.models})}

    def choose(self, eligible, frozen=(), policy="rotation"):
        return replay.choose(policy, self.models, self.family, self.stats,
                             self.joint, "task", ("a", "c"), 0, frozen, eligible)

    def test_distinct_families_required_before_first_call(self):
        self.assertIsNone(self.choose({"a", "b"}))
        self.assertEqual(self.choose({"a", "b", "c"}), "a")

    def test_replacement_cannot_use_frozen_family(self):
        self.assertEqual(self.choose({"b", "c", "d"}, ("a",)), "c")
        self.assertIsNone(self.choose({"b"}, ("a",)))

    def test_known_failure_replaces_only_missing_perspective(self):
        events = {"a": ("OK", 0), "c": ("MODEL_429", 5), "d": ("OK", 0)}
        with patch.object(replay, "fault", side_effect=lambda seed,t,m,f,s: events[m]) as probe:
            x = replay.simulate("rotation", "clean", 4, 11, self.family, self.stats, self.joint, self.data)
        self.assertEqual([c.args[2] for c in probe.call_args_list], ["a", "c", "d"])
        self.assertEqual(x["counts"]["complete"], 1)
        self.assertEqual(x["counts"]["attempts"], 3)

    def test_unknown_outcome_stops_without_replay(self):
        events = {"a": ("OK", 0), "c": ("UNKNOWN_TIMEOUT", 0)}
        with patch.object(replay, "fault", side_effect=lambda seed,t,m,f,s: events[m]) as probe:
            x = replay.simulate("rotation", "clean", 4, 11, self.family, self.stats, self.joint, self.data)
        self.assertEqual([c.args[2] for c in probe.call_args_list], ["a", "c"])
        self.assertEqual(x["counts"]["partial"], 1)
        self.assertEqual(x["counts"]["unknown"], 1)
        self.assertNotIn("complete", x["counts"])

    def test_two_attempts_cannot_be_extended(self):
        with patch.object(replay, "fault", side_effect=[("OK", 0), ("MODEL_429", 5)]) as probe:
            x = replay.simulate("rotation", "clean", 2, 11, self.family, self.stats, self.joint, self.data)
        self.assertEqual(probe.call_count, 2)
        self.assertEqual(x["counts"]["partial"], 1)

    def test_provider_cooldown_blocks_sibling_route(self):
        data = {str(i): self.data["t"] for i in range(3)}
        def events(seed,t,m,f,s):
            return ("PROVIDER_429", 5) if t == 0 and m == "a" else ("OK", 0)
        with patch.object(replay, "fault", side_effect=events) as probe:
            x = replay.simulate("rotation", "clean", 4, 11, self.family, self.stats, self.joint, data)
        trace = [(c.args[1], c.args[2]) for c in probe.call_args_list]
        self.assertEqual(trace[0], (0, "a"))
        self.assertFalse(any(m in ("a","b") for t,m in trace[1:]))
        self.assertEqual(x["counts"]["complete"], 3)

    def test_joint_objective_uses_pair_statistics(self):
        self.joint["task","a","c"] = .1
        self.joint["task","a","d"] = .7
        self.assertEqual(self.choose({"c","d"}, ("a",), "joint_context"), "d")


if __name__ == "__main__":
    unittest.main()
