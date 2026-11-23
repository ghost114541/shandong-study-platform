"""Synthetic regression for the read-only inventory."""
import hashlib
from pathlib import Path
import sqlite3
import sys
import tempfile
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / "scripts"))
from content001_counts import complete, inventory


class InventoryTest(unittest.TestCase):
    def test_schema_views_and_preferred_revision(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "study.sqlite3"
            with sqlite3.connect(path) as db:
                for script in sorted((ROOT / "src-tauri" / "migrations").glob("*.sql")):
                    db.executescript(script.read_text(encoding="utf-8"))
                db.executescript("""
                    PRAGMA user_version=9;
                    INSERT OR IGNORE INTO subject (id, name) VALUES ('math', '数学');
                    INSERT INTO question (id, subject_id) VALUES ('canonical', 'math'), ('copy', 'math');
                    INSERT INTO question_duplicate VALUES ('copy', 'canonical', 'test', '2026-01-01', 'fixture');
                    INSERT INTO question_revision (question_id, scope, content_version, content_json) VALUES
                      ('canonical', 'public', 1, '{"schema_version":1,"stem":{},"parts":[],"answer":{"content":[{"type":"blockMath"}]}}'),
                      ('canonical', 'user', 1, '{"schema_version":1,"stem":{},"parts":[]}'),
                      ('copy', 'public', 1, '{"schema_version":1,"stem":{},"parts":[]}');
                    INSERT INTO verification_record (revision_id, reviewer, checked_on, evidence, verdict)
                      VALUES (1, 'test', '2026-01-01', 'fixture', 'passed');
                """)
            db.close()
            before = hashlib.sha256(path.read_bytes()).digest()
            counts = inventory(path, "2026-11-24")
            self.assertEqual(counts["physical_question_rows"], 2)
            self.assertEqual(counts["visible_current_questions"]["top_level"], 1)
            self.assertEqual(counts["visible_current_questions"]["answer_fields_complete"], 0)
            self.assertEqual(counts["current_review_status"], {"unreviewed": 1})
            self.assertEqual(hashlib.sha256(path.read_bytes()).digest(), before)

    def test_requires_all_part_fields(self):
        rich = {"content": [{"type": "paragraph", "content": [{"type": "inlineMath"}]}]}
        self.assertTrue(complete({"parts": [], "answer": rich}, "answer"))
        self.assertFalse(complete({"parts": [{"answer": rich}, {}], "answer": rich}, "answer"))

    def test_rejects_missing_and_wrong_schema(self):
        with tempfile.TemporaryDirectory() as directory:
            path = Path(directory) / "study.sqlite3"
            with self.assertRaises(FileNotFoundError):
                inventory(path, "2026-11-24")
            sqlite3.connect(path).close()
            with self.assertRaisesRegex(ValueError, "Expected Schema 9"):
                inventory(path, "2026-11-24")


if __name__ == "__main__":
    unittest.main()
