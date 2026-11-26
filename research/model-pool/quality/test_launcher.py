"""Deterministic subprocess tests; no model or network calls."""
import pathlib
import subprocess
import tempfile
import unittest

LAUNCHER = pathlib.Path(__file__).with_name("run-bounded.sh").resolve()


class LauncherTest(unittest.TestCase):
    def test_statuses_with_errexit(self):
        for command, expected in [("printf ok", 0), ("exit 3", 3), ("sleep 10", 124)]:
            with self.subTest(command=command), tempfile.TemporaryDirectory() as tmp:
                out = pathlib.Path(tmp) / "run"
                proc = subprocess.run(
                    ["sh", "-e", str(LAUNCHER), str(out), "1", "sh", "-c", command],
                    timeout=10, capture_output=True,
                )
                self.assertEqual(proc.returncode, expected)
                self.assertEqual((out / "exit").read_text().strip(), str(expected))
                self.assertEqual((out / "state").read_text().strip(), "EXIT_RECORDED")
                self.assertTrue((out / "process.log").is_file())
                self.assertFalse((out / "exit.tmp").exists())
                before = (out / "exit").read_bytes()
                again = subprocess.run([str(LAUNCHER), str(out), "1", "true"], capture_output=True)
                self.assertNotEqual(again.returncode, 0)
                self.assertEqual((out / "exit").read_bytes(), before)

    def test_invalid_deadlines_do_not_start_child(self):
        for seconds in ("", "0", "00", "000", "01", "-1", "1.5", "3601", "999999999999999999999"):
            with self.subTest(seconds=seconds), tempfile.TemporaryDirectory() as tmp:
                out = pathlib.Path(tmp) / "run"
                marker = pathlib.Path(tmp) / "started"
                p = subprocess.run(
                    [str(LAUNCHER), str(out), seconds, "touch", str(marker)],
                    capture_output=True, timeout=5,
                )
                self.assertEqual(p.returncode, 2)
                self.assertFalse(out.exists())
                self.assertFalse(marker.exists())

    def test_nonzero_stops_sequence(self):
        with tempfile.TemporaryDirectory() as tmp:
            a, b = (str(pathlib.Path(tmp) / x) for x in ("a", "b"))
            p = subprocess.run(
                ["sh", "-ec", '"$1" "$2" 1 sh -c "exit 3"; "$1" "$3" 1 true',
                 "sh", str(LAUNCHER), a, b], capture_output=True,
            )
            self.assertEqual(p.returncode, 3)
            self.assertEqual((pathlib.Path(a) / "exit").read_text().strip(), "3")
            self.assertFalse(pathlib.Path(b).exists())


if __name__ == "__main__":
    unittest.main()
