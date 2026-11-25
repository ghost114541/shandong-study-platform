"""Revision and review lifecycle acceptance against a synthetic Schema 9 library."""
from contextlib import closing
from copy import deepcopy
import sqlite3
import unittest

import test_content002_trace_audit as fixture
from content002_trace_audit import ENGLISH_LISTENING_ID, audit, english_material_status
from content003_trace import rebuild, source_link


class IntegrityTest(unittest.TestCase):
    def setUp(self):
        self.case = fixture.TraceAuditTest()
        self.addCleanup(self.case.doCleanups)
        self.case.setUp()
        self.baseline = deepcopy(self.case.trace)
        self.baseline['question_sources'] = [source_link(link, resource) for link, resource in
                                             zip(self.baseline['links'], self.baseline['resources'])]
        self.db = sqlite3.connect(self.case.database)
        self.addCleanup(self.db.close)
        link, resource = self.baseline['links'][0], self.baseline['resources'][0]
        revision = dict(question_id=link['question_id'], revision_id=link['revision_id'],
                        paper_key='one', regions=link['regions'], source_key=link['source_key'],
                        original_file_id=resource['paper_file_id'], answer_file_id=None, analysis_file_id=None)
        spec = dict(role='original', sha256=resource['downloaded_sha256'],
                    path=resource['path'], source_url=resource['source_url'])
        self.journal = dict(version=2, questions={'q': revision}, papers={'one': {
            'paper_id':resource['paper_id'], 'descriptor':{'subject':'math','files':[spec]},
            'files':{spec['sha256']:dict(id=resource['paper_file_id'], role='original',
                                         sha256=spec['sha256'], page_count=1)},
        }})
        self.revision = revision

    def add_revision(self):
        self.db.execute("""INSERT INTO question_revision(id,question_id,base_revision_id,scope,content_version,content_json)
                           VALUES (4,'q',1,'user',1,?)""", (self.case.content,))
        self.db.commit()
        self.revision['extra_revisions'] = [{'revision_id':4}]

    def review(self, day, expires=None):
        self.db.execute("""INSERT INTO verification_record(revision_id,reviewer,checked_on,evidence,verdict,expires_on,review_of)
                           VALUES (1,'Synthetic reviewer',?,'Synthetic evidence','passed',?,(SELECT max(id) FROM verification_record WHERE revision_id=1))""",(day,expires))
        self.db.commit()

    def rebuilt(self, baseline=None, day=fixture.DAY, journal=None):
        return rebuild(self.db, baseline or self.baseline, journal or self.journal, day)

    def test_FIX_T06_T07_T08_revision_checks_and_dispute_are_isolated(self):
        self.revision.update(answer_checked=True, analysis_checked=True, content_check='disputed',
                             alternative_sources=['https://example.invalid/alternative'])
        self.add_revision()
        trace = self.rebuilt()
        links = {row['revision_id']:row for row in trace['links'] if row['question_id']=='q'}
        self.assertTrue(links[1]['answer_checked'])
        self.assertTrue(links[1]['analysis_checked'])
        self.assertEqual(links[1]['content_check'],'disputed')
        self.assertEqual(links[1]['alternative_sources'],self.revision['alternative_sources'])
        self.assertFalse(links[4].get('answer_checked',False))
        self.assertFalse(links[4]['analysis_checked'])
        self.assertNotIn('content_check',links[4])
        links[4].update(answer_checked=True, analysis_checked=True,content_check='disputed',
                        alternative_sources=self.revision['alternative_sources'])
        corrected = self.rebuilt(trace)
        new = next(row for row in corrected['links'] if row['revision_id']==4)
        self.assertFalse(new.get('answer_checked',False))
        self.assertFalse(new['analysis_checked'])
        self.assertEqual(new['unverified_legacy_checks'][0]['content_check'],'disputed')
        self.assertEqual(corrected,self.rebuilt(corrected))

    def test_FIX_T09_T10_T11_review_refresh_expiration_and_revision_isolation(self):
        before = self.rebuilt()
        next_day = '2031-01-01'
        expired_day = '2031-01-02'
        self.review(fixture.DAY,next_day)
        passed = self.rebuilt(before)
        self.assertEqual(passed['links'][0]['review_status'],'passed')
        self.assertEqual(passed['links'][0]['expires_on'],next_day)
        self.assertEqual(self.rebuilt(passed,next_day)['links'][0]['review_status'],'passed')
        self.assertEqual(self.rebuilt(passed,expired_day)['links'][0]['review_status'],'expired')
        self.review(expired_day)
        updated = self.rebuilt(passed,expired_day)
        self.assertEqual(len(updated['links'][0]['review_history']),2)
        self.assertEqual(updated['links'][0]['review_status'],'passed')
        self.assertEqual(updated,self.rebuilt(updated,expired_day))
        for key in ('resources','compositions'):
            self.assertEqual(before[key],updated[key])
        self.assertEqual(before['links'][0]['regions'],updated['links'][0]['regions'])
        stale = audit(self.case.database,passed,self.case.root,expired_day,mode='scoped')
        self.assertIn('review_status_or_evidence_mismatch',{row['code'] for row in stale['errors']})
        self.add_revision()
        newer = self.rebuilt(updated,expired_day)
        fresh = next(row for row in newer['links'] if row['revision_id']==4)
        self.assertEqual(fresh['review_status'],'unreviewed')
        self.assertNotIn('review_history',fresh)

    def test_FIX_T12_T13_replay_and_identity_conflict(self):
        first = self.rebuilt()
        self.add_revision()
        combined = self.rebuilt(first)
        empty = dict(version=2,papers={},questions={})
        replay = self.rebuilt(self.rebuilt(combined,journal=empty))
        self.assertEqual(replay,combined)
        changed = deepcopy(self.journal)
        changed['questions']['q']['regions'][0]['rect'][0] += .025
        with self.assertRaisesRegex(ValueError,'Conflicting provenance'):
            self.rebuilt(combined,journal=changed)
        self.assertEqual(replay,combined)

    def test_FIX_T17_external_audio_is_not_in_app_or_shandong_exam_completion(self):
        trace = {'paper_quality':{'p':'complete'},'resources':[
            {'paper_id':'p','paper_file_role':role} for role in ('original','answer')]}
        trace['supplemental_resources'] = [
            {'resource_id':ENGLISH_LISTENING_ID,'paper_id':'p','status':'verified_external'}
        ]
        unverified = english_material_status(trace,set())['p']
        self.assertFalse(unverified['matching_external_audio'])
        verified = english_material_status(trace,{ENGLISH_LISTENING_ID})['p']
        self.assertTrue(verified['matching_external_audio'])
        self.assertTrue(verified['paper_complete'])
        self.assertTrue(verified['answer_complete'])
        self.assertEqual(verified['shandong_actual_exam_complete'],'needs_verification')
        self.assertFalse(verified['in_app_complete'])
        self.assertEqual(verified['public_redistribution'],'not_cleared')


if __name__ == '__main__':
    unittest.main()
