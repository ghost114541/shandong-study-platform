"""Failure cases for database-led provenance discovery, using synthetic fixtures."""
from contextlib import closing
import sqlite3
import unittest

import test_content002_trace_audit as fixture
from content002_trace_audit import audit
from content003_trace import source_link


class FullAuditTest(unittest.TestCase):
    def setUp(self):
        case = fixture.TraceAuditTest()
        self.addCleanup(case.doCleanups)
        case.setUp()
        self.case = case
        self.trace = case.trace
        self.trace.update(version=2, paper_states={'p1':'partial', 'p2':'partial'})
        self.trace['question_sources'] = [
            source_link(link, resource)
            for link, resource in zip(self.trace['links'], self.trace['resources'])
        ]
        self.trace['exclusions'] = [
            dict(kind='question', id='other', evidence='Unrelated synthetic fixture')
        ]

    def audit(self, mode='full'):
        return audit(self.case.database, self.trace, self.case.root, fixture.DAY, mode=mode)

    def errors(self):
        return {issue['code'] for issue in self.audit()['errors']}

    def test_full_pass_and_duplicate_occurrences(self):
        result = self.audit()
        self.assertEqual(result['errors'], [])
        self.assertEqual(result['counts']['database_current_logical_questions'], 1)
        self.assertEqual(result['counts']['occurrences'], 2)

    def test_omitted_paper_is_discovered_even_after_metadata_removed(self):
        self.trace['paper_ids'].pop()
        del self.trace['paper_states']['p2']
        self.trace['resources'].pop()
        self.trace['links'].pop()
        self.trace['question_sources'].pop()
        self.assertEqual(self.audit('scoped')['errors'], [])
        self.assertTrue({'database_paper_unmapped', 'database_file_unmapped_full',
                         'database_region_unmapped_full', 'database_occurrence_unmapped_full'}
                        <= self.errors())

    def test_independent_question_requires_source(self):
        self.trace['exclusions'].clear()
        self.assertIn('database_question_unmapped', self.errors())
        raw = self.case.root / 'independent.txt'
        raw.write_text('Synthetic independent source', encoding='utf8')
        from content002_trace_audit import digest
        self.trace['question_sources'].append(dict(question_id='other', revision_id=3, source_id='website-1',
            source_url='https://example.invalid/question', path=raw.name, sha256=digest(raw),
            kind='web', usage_scope='PERSONAL_ONLY', answer_status='present',
            analysis_status='missing', review_status='unreviewed'))
        self.assertEqual(self.errors(), set())
        raw.unlink()
        self.assertIn('question_source_missing', self.errors())

    def test_waiting_for_split_is_pending_but_requires_pdf(self):
        self.trace['paper_states']['p2'] = 'awaiting_split'
        self.trace['links'].pop()
        self.trace['question_sources'].pop()
        self.trace['exclusions'].append(dict(kind='question', id='alias', evidence='Unrelated fixture'))
        with closing(sqlite3.connect(self.case.database)) as db, db:
            db.execute("DELETE FROM paper_region WHERE paper_id='p2'")
            db.execute("DELETE FROM question_occurrence WHERE paper_id='p2'")
        self.assertEqual(self.errors(), set())
        self.assertIn({'record':'p2', 'split':'awaiting_split'}, self.audit()['pending'])
        (self.case.root/'f2.pdf').unlink()
        self.assertIn('private_file_missing_or_uncontrolled', self.errors())

    def test_current_revision_change_and_forged_review(self):
        with closing(sqlite3.connect(self.case.database)) as db, db:
            db.execute("""INSERT INTO question_revision
                          (id,question_id,base_revision_id,scope,content_version,content_json)
                          VALUES (4,'q',1,'user',1,?)""",(self.case.content,))
        self.trace['question_sources'][0]['review_status'] = 'passed'
        self.assertTrue({'database_current_revision_unmapped','question_source_review_mismatch',
                         'current_revision_unmapped'} <= self.errors())
        self.assertEqual(self.audit()['counts']['fixed_items'], 1)


if __name__ == '__main__':
    unittest.main()
