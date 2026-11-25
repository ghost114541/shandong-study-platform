"""Seed and audit only the dedicated native patch test fixture."""
from contextlib import closing
from copy import deepcopy
import json
from pathlib import Path
import sqlite3
import sys

sys.path.insert(0, str(Path(__file__).resolve().parents[1] / 'scripts'))
from content002_trace_audit import audit, readonly_uri
from content003_trace import rebuild, write_trace

DAY = '2026-11-25'
QID = 'content003-patch-question'


def seed(db):
    questions = db.execute("SELECT id FROM question").fetchall()
    assert questions == [(QID,)], 'Expected exactly one synthetic question'
    a, raw = db.execute("SELECT id, content_json FROM question_revision").fetchone()
    content = json.loads(raw)
    history = [a]
    for explanation in ('First alternate explanation.', 'Current alternate explanation.'):
        content['analysis']['content'][0]['content'][0]['text'] = explanation
        history.append(db.execute("""INSERT INTO question_revision
            (question_id,base_revision_id,scope,content_version,content_json)
            VALUES (?,?,'user',1,?) RETURNING id""", (QID, history[-1], json.dumps(content))).fetchone()[0])
    _, b, _ = history
    db.execute("INSERT INTO composition(id,title) VALUES ('patch-pin','Synthetic pinned revision')")
    db.execute("INSERT INTO composition_item(composition_id,position,question_id,revision_id) VALUES ('patch-pin',1,?,?)",
               (QID,b))
    db.execute("""INSERT INTO verification_record(revision_id,reviewer,checked_on,evidence,verdict)
        VALUES (?,'Synthetic reviewer',?,'Synthetic evidence','passed')""", (b,DAY))
    return dict(extra_revisions=[{'revision_id':rid} for rid in history[1:]],
                pin=dict(composition_id='patch-pin',items=[dict(position=1,question_id=QID,revision_id=b)]))


def check(database, root, db):
    journal = json.loads((root/'patch-registry.json').read_text(encoding='utf-8-sig'))
    baseline = dict(version=2,paper_ids=[],resources=[],links=[],question_sources=[],compositions=[])
    trace = rebuild(db,baseline,journal,DAY)
    assert trace == rebuild(db,trace,journal,DAY)
    result = audit(database,trace,root,DAY,mode='full')
    assert not result['errors'],result['errors']
    rows = db.execute("SELECT id,base_revision_id FROM question_revision ORDER BY id").fetchall()
    (a,_),(b,ab),(c,bc) = rows
    assert (a,b) == (ab,bc)
    assert db.execute("SELECT id FROM current_question_revision").fetchall() == [(c,)]
    assert result['counts']['unique_logical_questions'] == 1
    assert result['counts']['occurrences'] == 2
    assert result['counts']['revision_links'] == 3
    assert result['counts']['canonical_source_complete'] == 1
    assert result['counts']['fixed_items'] == 1
    assert result['counts']['canonical_review_passed'] == 0
    assert result['counts']['canonical_answer_checked'] == 0
    assert result['counts']['canonical_analysis_checked'] == 0
    assert trace['compositions'][0]['items'][0]['revision_id'] == b
    assert len(trace['paper_occurrences']) == 1
    occurrence = trace['paper_occurrences'][0]
    assert 'revision_id' not in occurrence
    assert len(trace['question_sources']) == 3
    assert occurrence['resource_id'] not in {r['resource_id'] for r in trace['question_sources']}
    revisions = {row['revision_id']:row for row in trace['question_sources']}
    assert revisions[a]['answer_checked'] and revisions[a]['analysis_checked']
    assert revisions[b]['review_status'] == 'passed'
    assert revisions[c]['review_status'] == 'unreviewed'
    assert not revisions[c].get('answer_checked') and not revisions[c].get('analysis_checked')
    invalid = deepcopy(trace)
    invalid['paper_occurrences'][0]['review_status'] = 'passed'
    assert 'unexpected_occurrence_metadata' in {
        row['code'] for row in audit(database,invalid,root,DAY,mode='full')['errors']
    }
    write_trace(root/'patch-synthetic-trace.json',trace)
    return {'stage':'multi_revision_full_audit','logical_questions':1,'revision_links':3,
            'paper_occurrences':2,'new_occurrence_only':1,'historical_fixed_pins':1,
            'historical_formal_passes':1,'current_formal_passes':0,'current_content_checks':0,
            'errors':0,'repeat_rebuild_equal':True,'forged_occurrence_review_rejected':True}


mode, arg, root = sys.argv[1:]
database = Path(arg).resolve(strict=True)
assert database.parent.name == 'org.shandong-study.content003-2-patch-isolated'
if mode == 'seed':
    with closing(sqlite3.connect(database)) as db, db:
        db.execute('PRAGMA foreign_keys=ON')
        assert db.execute('PRAGMA user_version').fetchone() == (9,)
        print(json.dumps(seed(db)))
else:
    assert mode == 'check'
    with closing(sqlite3.connect(readonly_uri(database),uri=True)) as db:
        print(json.dumps(check(database,Path(root),db)))
