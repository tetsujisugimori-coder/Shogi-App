"""Synthetic tests for bounded public-log protection. Historical Git objects untouched."""
import importlib.util
from pathlib import Path
import tempfile
import unittest

spec = importlib.util.spec_from_file_location("w1i_public_gate", Path(__file__).with_name("stage-w1i-public-log-gate.py"))
gate = importlib.util.module_from_spec(spec)
spec.loader.exec_module(gate)

class PublicGateTests(unittest.TestCase):
    def setUp(self):
        self.temp = tempfile.TemporaryDirectory(prefix="w1i-public-synthetic-")
        self.addCleanup(self.temp.cleanup)
        self.root = Path(self.temp.name)
        for name in gate.PUBLIC_PATHS:
            path = self.root / name
            path.parent.mkdir(parents=True, exist_ok=True)
            path.write_text("synthetic redacted output\\n", encoding="utf-8")

    def test_clean_outputs_pass_without_comparison_permission(self):
        result = gate.verify_public_outputs(self.root)
        self.assertEqual(result["status"], "PASS")
        self.assertEqual(len(result["files"]), 4)
        self.assertFalse(result["history_old_two_removed"])
        self.assertFalse(result["permission_to_compare"])

    def test_cloud_workspace_rejected(self):
        (self.root / gate.PUBLIC_PATHS[2]).write_text("stack at /workspace/secret/sample", encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "PUBLIC_EVIDENCE_UNREDACTED"):
            gate.verify_public_outputs(self.root)

    def test_windows_workspace_rejected(self):
        sample = "C:" + chr(92) + "Users" + chr(92) + "synthetic" + chr(92) + "test"
        (self.root / gate.PUBLIC_PATHS[3]).write_text("stack at " + sample, encoding="utf-8")
        with self.assertRaisesRegex(ValueError, "PUBLIC_EVIDENCE_UNREDACTED"):
            gate.verify_public_outputs(self.root)

    def test_missing_public_record_refused(self):
        (self.root / gate.PUBLIC_PATHS[0]).unlink()
        with self.assertRaisesRegex(ValueError, "PUBLIC_EVIDENCE_MISSING_OR_LINK"):
            gate.verify_public_outputs(self.root)

    def test_binary_record_refused(self):
        (self.root / gate.PUBLIC_PATHS[1]).write_bytes(bytes((255, 254)))
        with self.assertRaisesRegex(ValueError, "PUBLIC_EVIDENCE_NOT_UTF8"):
            gate.verify_public_outputs(self.root)

if __name__ == "__main__":
    unittest.main()
