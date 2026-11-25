"""Mixed inventory and multi-batch provenance regressions on Schema 9 fixtures."""
from contextlib import closing
from copy import deepcopy
import json
import sqlite3

import test_content002_trace_audit as fixture
import test_content003_full_audit as full
from content002_trace_audit import digest
from content003_trace import rebuild


class MixedInventory(full.FullAuditTest):
    def test_current_revisions_and_database_review(self):
        trace = self.trace
        trace['exclusions'].clear()
        content = json.loads(self.case.content)
        complete = json.dumps(dict(content, analysis={'text':'Reference explanation'}))
        missing = json.dumps(dict(content, answer=None))
        with closing(sqlite3.connect(self.case.database)) as db, db:
            db.execute("INSERT INTO question VALUES ('image','math'),('local','math'),('manual','math')")
            db.execute("""INSERT INTO question_revision(id,question_id,base_revision_id,scope,content_version,content_json)
                          VALUES (4,'other',3,'user',1,?),(5,'image',null,'user',1,?),
                                 (6,'local',null,'user',1,?),(7,'manual',null,'user',1,?)""",
                       (complete, missing, complete, complete))
            db.executemany("""INSERT INTO verification_record(revision_id,reviewer,checked_on,evidence,verdict)
                            VALUES (?,'Fixture reviewer',?,'Fixture evidence',?)""",
                           [(1, fixture.DAY, 'passed'),(5, fixture.DAY, 'disputed'),
                            (6, fixture.DAY, 'failed')])
        for qid, rid, kind, answer, analysis, status in [
            ('other',3,'web','present','missing','unreviewed'),
            ('other',4,'web','present','complete','unreviewed'),
            ('image',5,'screenshot','missing','missing','disputed'),
            ('local',6,'local','present','complete','failed'),
            ('manual',7,'manual','present','complete','unreviewed'),
        ]:
            raw = self.case.root / (qid+'.txt')
            raw.write_text('Synthetic source', encoding='utf8')
            metadata = (dict(checked_at=fixture.DAY, reviewer='Fixture reviewer', evidence='Fixture evidence')
                        if status != 'unreviewed' else {})
            trace['question_sources'].append(dict(question_id=qid,revision_id=rid,kind=kind,
                source_id=qid, source_url='https://example.invalid/'+qid, path=raw.name,
                sha256=digest(raw), usage_scope='PERSONAL_ONLY', answer_status=answer,
                analysis_status=analysis, review_status=status, analysis_checked=rid == 4, **({'check_revision_id':rid} if rid == 4 else {}), **metadata))
        for entry in (trace['links'][0], trace['question_sources'][0]):
            entry.update(review_status='passed', checked_at=fixture.DAY,
                         reviewer='Fixture reviewer', evidence='Fixture evidence')
        result = self.audit()
        self.assertEqual(result['errors'], [])
        expected = dict(unique_logical_questions=5, database_current_logical_questions=5,
                        canonical_with_answer=4, canonical_with_all_analysis_fields=3,
                        canonical_analysis_checked=1, canonical_review_pending=2,
                        canonical_review_passed=1, canonical_review_disputed=1,
                        canonical_review_failed=1, canonical_source_complete=5)
        self.assertEqual({k:result['counts'][k] for k in expected}, expected)
        trace['question_sources'][3]['review_status'] = 'passed'
        result = self.audit()
        self.assertIn('question_source_review_mismatch', {row['code'] for row in result['errors']})
        self.assertEqual(result['counts']['canonical_review_passed'], 1)

    def test_append_replay_and_conflict(self):
        baseline = self.trace
        resource = baseline['resources'][0]
        sha = resource['downloaded_sha256']
        original = dict(role='original',sha256=sha,path=resource['path'],source_url=resource['source_url'])
        original_file = dict(id='f1',sha256=sha,role='original',page_count=1)
        paper = dict(paper_id='p1', descriptor=dict(subject='math',complete=True,files=[original]),
                     files=dict(original=original_file))
        first = dict(version=1,papers={'paper':paper},questions={},compositions=baseline['compositions'])
        second = deepcopy(first)
        paper2 = second['papers']['paper']
        paper2['files'] = {sha:original_file}
        second['version'] = 2
        for i, role in enumerate(('original','answer','answer','analysis','analysis'),1):
            checksum = str(i)*64
            spec = dict(role=role,sha256=checksum,path=f'version{i}.pdf',
                        source_url=f'https://example.invalid/version/{i}')
            paper2['descriptor']['files'].append(spec)
            paper2['files'][checksum] = dict(id=f'version{i}',sha256=checksum,role=role,page_count=1)
        with closing(sqlite3.connect(self.case.database)) as db:
            first_trace = rebuild(db, baseline, first, fixture.DAY)
            self.assertEqual(first_trace, rebuild(db, baseline, first, fixture.DAY))
            self.assertEqual(first_trace, rebuild(db, first_trace, first, fixture.DAY))
            both = rebuild(db, first_trace, second, fixture.DAY)
            self.assertEqual(len(both['resources']),len(baseline['resources'])+5)
            for field in ('paper_ids','compositions','links','question_sources'):
                self.assertEqual(both[field],baseline[field])
            self.assertEqual(both,rebuild(db,rebuild(db,both,first,fixture.DAY),second,fixture.DAY))
            changed = deepcopy(second)
            changed['papers']['paper']['descriptor']['files'][-1]['source_url'] += '/changed'
            with self.assertRaisesRegex(ValueError, 'Conflicting file provenance'):
                rebuild(db,both,changed,fixture.DAY)
            changed = deepcopy(first)
            changed['compositions'][0]['items'][0]['revision_id'] = 2
            with self.assertRaisesRegex(ValueError, 'Conflicting provenance'):
                rebuild(db,both,changed,fixture.DAY)
