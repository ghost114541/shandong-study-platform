"""Rebuild a private v2 provenance sidecar from a baseline and committed import journal."""
import argparse
from contextlib import closing
from datetime import date
import json
from pathlib import Path
import sqlite3

from content001_counts import complete, has_content
from content003_collect import write_json


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


def source_link(link, resource):
    return dict(
        source_id=f"{link['question_id']}/{link['resource_id']}/{link['source_key']}",
        kind='paper', question_id=link['question_id'], revision_id=link['revision_id'],
        resource_id=link['resource_id'], source_url=resource['source_url'],
        sha256=resource['downloaded_sha256'], usage_scope='PERSONAL_ONLY',
        **{field: link[field] for field in (
            'source_key', 'answer_status', 'analysis_status', 'review_status',
        )},
        **{field: link[field] for field in ('checked_at', 'reviewer', 'evidence') if field in link},
    )


def rebuild(db, baseline, journal, as_of):
    trace = dict(baseline, version=2)
    trace.setdefault('exclusions', [])
    trace['paper_states'] = {**dict.fromkeys(baseline['paper_ids'], 'partial'),
                             **baseline.get('paper_states', {})}
    trace.setdefault('question_sources', [])
    trace['compositions'].extend(journal.get('compositions', []))
    trace['paper_quality'] = {**baseline.get('paper_quality', {})}
    by_file = {r['paper_file_id']: r['resource_id'] for r in trace['resources']}
    paper_resources = {}
    for key, record in journal['papers'].items():
        descriptor = record['descriptor']
        pid = record['paper_id']
        if pid not in trace['paper_ids']:
            trace['paper_ids'].append(pid)
        has_questions = any(q.get('paper_key') == key for q in journal['questions'].values())
        trace['paper_states'][pid] = trace['paper_states'].get(pid, 'awaiting_split')
        if has_questions and trace['paper_states'][pid] == 'awaiting_split':
            trace['paper_states'][pid] = 'partial'
        trace['paper_quality'][pid] = ('complete' if descriptor.get('complete') else
                                      'missing_required_material')
        for spec in descriptor['files']:
            file = record['files'][spec['role']]
            rid = by_file.get(file['id'], f"CONTENT-003/{key}/{spec['role']}")
            paper_resources[key, spec['role']] = rid
            if file['id'] in by_file:
                continue
            by_file[file['id']] = rid
            trace['resources'].append(dict(
                resource_id=rid,
                paper_id=pid, paper_file_id=file['id'], paper_file_role=spec['role'],
                path=spec['path'], subject_id=descriptor['subject'], page_count=file['page_count'],
                downloaded_sha256=spec['sha256'], source_url=spec['source_url'],
                download_url=spec.get('download_url'), usage_scope='PERSONAL_ONLY',
                retrieved_on=spec.get('retrieved_on', as_of), imported_at=as_of, updated_at=as_of,
            ))
    revision_items = [item | revision
                      for item in journal['questions'].values()
                      for revision in [{}, *item.get('extra_revisions', [])]]
    for item in revision_items:
        qid, rid = item['question_id'], item['revision_id']
        raw, = db.execute("SELECT content_json FROM question_revision WHERE question_id=? AND id=?",
                          (qid, rid)).fetchone()
        content = json.loads(raw)
        analyses = [has_content(part.get('analysis')) for part in content['parts'] or [content]]
        link = dict(question_id=qid, revision_id=rid,
                    answer_status='present' if complete(content, 'answer') else 'missing',
                    analysis_status='complete' if all(analyses) else 'partial' if any(analyses) else 'missing',
                    review_status='unreviewed', imported_at=as_of, updated_at=as_of,
                    analysis_checked=item.get('analysis_checked', False))
        if item.get('content_check'):
            link.update(content_check=item['content_check'], alternative_sources=item['alternative_sources'])
        key = item.get('paper_key')
        if key:
            asset = paper_resources.get((key, 'answer')) or paper_resources.get((key, 'analysis'))
            trace['links'].append(dict(link, resource_id=paper_resources[key, 'original'],
                                       source_key=item['source_key'], regions=item['regions'],
                                       **({'answer_resource_id': asset} if asset else {})))
        else:
            spec = item['source']
            trace['question_sources'].append(dict(
                link, kind=spec['kind'], source_id=f'{qid}/independent', path=spec['path'],
                source_url=spec['url'], sha256=spec['sha256'], usage_scope='PERSONAL_ONLY',
            ))
    files = {row['resource_id']: row for row in trace['resources']}
    existing = {(r['question_id'], r['revision_id'], r['source_id']) for r in trace['question_sources']}
    for link in trace['links']:
        entry = source_link(link, files[link['resource_id']])
        if (entry['question_id'], entry['revision_id'], entry['source_id']) not in existing:
            trace['question_sources'].append(entry)
    return trace


if __name__ == '__main__':
    p = argparse.ArgumentParser(description=__doc__)
    p.add_argument('database', type=Path)
    p.add_argument('baseline', type=Path)
    p.add_argument('journal', type=Path)
    p.add_argument('output', type=Path)
    p.add_argument('--as-of', required=True, type=date.fromisoformat)
    args = p.parse_args()
    with closing(sqlite3.connect(args.database.resolve(strict=True).as_uri()+'?mode=ro', uri=True)) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        trace = rebuild(db, load(args.baseline), load(args.journal), args.as_of.isoformat())
    write_json(args.output, trace)
