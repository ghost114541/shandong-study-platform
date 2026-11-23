"""Read-only provenance regressions using original synthetic records."""
from contextlib import closing
import hashlib
import json
from pathlib import Path
import sqlite3
import sys
from tempfile import TemporaryDirectory
import unittest

ROOT = Path(__file__).resolve().parents[1]
sys.path.insert(0, str(ROOT / 'scripts'))
from content002_trace_audit import audit, check_register

DAY = '2026-11-24'
RECT = [0.1, 0.2, 0.8, 0.4]


class TraceAuditTest(unittest.TestCase):
    def setUp(self):
        tmp = TemporaryDirectory()
        self.addCleanup(tmp.cleanup)
        self.root = Path(tmp.name)
        self.database = self.root / 'study.sqlite3'
        self.trace = dict(version=1, paper_ids=['p1', 'p2'], resources=[], links=[], compositions=[
            dict(composition_id='c', items=[dict(position=1, question_id='q', revision_id=1)])
        ])
        with closing(sqlite3.connect(self.database)) as db, db:
            for migration in sorted((ROOT / 'src-tauri/migrations').glob('*.sql')):
                db.executescript(migration.read_text(encoding='utf-8'))
            db.executescript("""
                PRAGMA foreign_keys=ON;
                PRAGMA user_version=9;
                INSERT OR IGNORE INTO subject VALUES ('math', 'Mathematics');
                INSERT INTO question VALUES ('q','math'),('alias','math'),('other','math');
                INSERT INTO question_duplicate VALUES ('alias','q','Fixture reviewer','2026-01-01','Synthetic equivalence');
                INSERT INTO paper(id,title,subject_id) VALUES ('p1','Fixture A','math'),('p2','Fixture B','math');
                INSERT INTO composition (id,title) VALUES ('c','Fixture composition');
            """)
            self.content = json.dumps(dict(schema_version=1, stem={'text': 'How many objects are in an empty box?'},
                                           answer={'text': 'Zero'}, parts=[]))
            db.executemany("""INSERT INTO question_revision (id,question_id,scope,content_version,content_json)
                              VALUES (?, ?, 'user', 1, ?)""",
                           [(i, name, self.content) for i, name in enumerate(('q','alias','other'), 1)])
            db.execute("INSERT INTO composition_item(composition_id,position,question_id,revision_id) VALUES ('c',1,'q',1)")
            for i, qid, revision in [(1,'q',1), (2,'alias',2)]:
                paper, file, resource = f'p{i}', f'f{i}', f'r{i}'
                raw = f'Synthetic opaque PDF test bytes {i}'.encode()
                expected = hashlib.sha256(raw).hexdigest()
                private = self.root / f'{file}.pdf'
                private.write_bytes(raw)
                blob = self.root / 'paper-pdfs' / expected[:2] / expected
                blob.parent.mkdir(parents=True,exist_ok=True)
                blob.write_bytes(raw)
                db.execute("""INSERT INTO paper_file(id,paper_id,role,sha256,byte_size,page_count,original_name)
                              VALUES (?,?,'original',?,?,1,?)""", (file,paper,expected,len(raw),private.name))
                db.execute("INSERT INTO question_occurrence VALUES (?,'1',?)",(paper,qid))
                db.execute("""INSERT INTO paper_region(paper_id,source_key,question_id,file_id,ordinal,page_index,x0,y0,x1,y1)
                              VALUES (?,'1',?,?,0,0,?,?,?,?)""",(paper,qid,file,*RECT))
                self.trace['resources'].append(dict(resource_id=resource,paper_id=paper,paper_file_id=file,
                    paper_file_role='original',subject_id='math',downloaded_sha256=expected,page_count=1,
                    path=private.name,source_url='https://example.invalid/source',usage_scope='PERSONAL_ONLY',
                    retrieved_on=DAY,imported_at=DAY,updated_at=DAY))
                self.trace['links'].append(dict(resource_id=resource,question_id=qid,revision_id=revision,source_key='1',
                    regions=[dict(page_index=0,rect=RECT.copy())],answer_status='present',analysis_status='missing',
                    review_status='unreviewed',imported_at=DAY,updated_at=DAY))

    def result(self):
        before = self.database.read_bytes()
        result = audit(self.database,self.trace,self.root,DAY)
        self.assertEqual(self.database.read_bytes(),before)
        return result

    def assert_flagged(self, code):
        self.assertIn(code,{entry['code'] for entry in self.result()['errors']})

    def test_duplicate_resource(self):
        self.trace['resources'].append(self.trace['resources'][0].copy())
        self.assert_flagged('duplicate_resource_id')

    def test_nonexistent_paper(self):
        self.trace['resources'][0]['paper_id'] = 'missing'
        self.assert_flagged('paper_missing')

    def test_hash_mismatch(self):
        (self.root/'f1.pdf').write_bytes(b'corrupted')
        self.assert_flagged('private_hash_mismatch')

    def test_missing_question(self):
        self.trace['links'][0]['question_id'] = 'missing'
        self.assert_flagged('question_missing')

    def test_wrong_revision_owner(self):
        self.trace['links'][0]['revision_id'] = 3
        self.assert_flagged('revision_missing_or_wrong_owner')

    def test_new_revision_requires_mapping_and_retains_pin(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute("""INSERT INTO question_revision
                          (id,question_id,base_revision_id,scope,content_version,content_json)
                          VALUES (4,'q',1,'user',1,?)""",(self.content,))
        self.assert_flagged('current_revision_unmapped')
        self.trace['links'].append(dict(self.trace['links'][0],revision_id=4))
        self.assertEqual(self.result()['errors'],[])
        self.assertEqual(self.result()['counts']['fixed_items'],1)
        self.trace['links'].pop(0)
        self.assert_flagged('revision_history_gap')

    def test_page_out_of_range(self):
        self.trace['links'][0]['regions'][0]['page_index'] = 1
        self.assert_flagged('page_out_of_range_or_empty')

    def test_cross_paper_alias_never_inflates_logical_count(self):
        result = self.result()
        self.assertEqual(result['errors'],[])
        self.assertEqual(result['counts']['occurrences'],2)
        self.assertEqual(result['counts']['unique_logical_questions'],1)

    def test_answer_does_not_create_review(self):
        self.trace['links'][0]['review_status'] = 'passed'
        self.assert_flagged('review_status_or_evidence_mismatch')

    def test_registry_requires_source_id(self):
        errors = check_register(self.trace['resources'], [])
        self.assertEqual([row['code'] for row in errors], ['resource_absent_from_register'] * 2)

    def test_registry_requires_matching_hash_and_source(self):
        entry = self.trace['resources'][0]
        row = dict(resource_id=entry['resource_id'], source_url=entry['source_url'],
                   sha256=entry['downloaded_sha256'], imported='yes', usage_scope=entry['usage_scope'],
                   retrieved_on=DAY, file_url='')
        self.assertEqual(check_register([entry], [row]), [])
        row['source_url'] = 'https://example.invalid/different'
        self.assertEqual(check_register([entry], [row])[0]['code'], 'resource_register_mismatch')
        row['source_url'] = entry['source_url']
        row['sha256'] = 'f' * 64
        self.assertEqual(check_register([entry], [row])[0]['code'], 'resource_register_mismatch')

    def test_wrong_fixed_pin(self):
        self.trace['compositions'][0]['items'][0]['revision_id'] = 2
        self.assert_flagged('composition_pin_mismatch')

    def test_missing_private_file(self):
        (self.root/'f1.pdf').unlink()
        self.assert_flagged('private_file_missing_or_uncontrolled')

    def test_omitted_scoped_paper(self):
        self.trace['resources'].pop()
        self.trace['links'].pop()
        self.assert_flagged('scoped_original_missing')

    def test_parent_path_rejected(self):
        self.trace['resources'][0]['path'] = '../outside.pdf'
        self.assert_flagged('private_file_missing_or_uncontrolled')

    def test_review_must_match_evidence_and_date(self):
        with closing(sqlite3.connect(self.database)) as db, db:
            db.execute("""INSERT INTO verification_record(revision_id,reviewer,checked_on,evidence,verdict)
                          VALUES (1,'Fixture reviewer',?,'Synthetic evidence','passed')""",(DAY,))
        self.trace['links'][0].update(review_status='passed',reviewer='Fixture reviewer',
                                      evidence='Synthetic evidence',checked_at=DAY)
        self.assertEqual(self.result()['errors'],[])
        self.assertEqual(self.result()['counts']['canonical_review_passed'],1)
        self.trace['links'][0]['evidence'] = 'Other evidence'
        self.assert_flagged('review_status_or_evidence_mismatch')


if __name__ == '__main__':
    unittest.main()
