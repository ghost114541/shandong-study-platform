"""Rebuild a private v2 provenance sidecar from a baseline and committed import journal."""
import argparse
from contextlib import closing
from copy import deepcopy
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
        **{field: link[field] for field in ('checked_at', 'reviewer', 'evidence', 'answer_checked') if field in link},
    )


def merge_row(rows, key, entry, *, ignore=()):
    identity = key(entry)
    if identity not in rows:
        rows[identity] = entry
        return
    old = rows[identity]
    if ({k: v for k, v in old.items() if k not in ignore} !=
            {k: v for k, v in entry.items() if k not in ignore}):
        raise ValueError(f'Conflicting provenance for {identity}')


def indexed(rows, key):
    result = {}
    for entry in rows:
        merge_row(result, key, entry)
    return result


def file_key(row):
    return row['paper_file_id']


def link_key(row):
    return tuple(row[key] for key in ('question_id', 'revision_id', 'resource_id', 'source_key'))


def source_key(row):
    return tuple(row[key] for key in ('question_id', 'revision_id', 'source_id'))


def chosen_file(entries, file_id, role):
    if file_id:
        if file_id not in entries or entries[file_id]['paper_file_role'] != role:
            raise ValueError(f'Invalid {role} file ID: {file_id}')
        return entries[file_id]
    matches = [row for row in entries.values() if row['paper_file_role'] == role]
    if len(matches) > 1:
        raise ValueError(f'Ambiguous {role} provenance. Specify the exact file version.')
    return next(iter(matches), None)


def rebuild(db, baseline, journal, as_of):
    if journal['version'] not in (1, 2):
        raise ValueError('Unsupported import journal version')
    trace = deepcopy(baseline)
    trace['version'] = 2
    trace.setdefault('exclusions', [])
    trace['paper_states'] = {**dict.fromkeys(baseline['paper_ids'], 'partial'),
                             **baseline.get('paper_states', {})}
    trace.setdefault('paper_quality', {})
    trace['paper_ids'] = list(dict.fromkeys(trace['paper_ids']))
    resources = indexed(trace['resources'], file_key)
    links = indexed(trace['links'], link_key)
    sources = indexed(trace.get('question_sources', []), source_key)
    compositions = indexed(trace['compositions'], lambda row: row['composition_id'])
    dates = ('imported_at', 'updated_at')
    for pin in journal.get('compositions', []):
        merge_row(compositions, lambda row: row['composition_id'], pin)
    paper_resources = {}
    for key, record in journal['papers'].items():
        descriptor = record['descriptor']
        pid = record['paper_id']
        if pid not in trace['paper_ids']:
            trace['paper_ids'].append(pid)
        has_questions = any(q.get('paper_key') == key for q in journal['questions'].values())
        trace['paper_states'].setdefault(pid, 'awaiting_split')
        if has_questions and trace['paper_states'][pid] == 'awaiting_split':
            trace['paper_states'][pid] = 'partial'
        trace['paper_quality'].setdefault(pid, 'complete' if descriptor.get('complete') else
                                          'missing_required_material')
        paper_resources[key] = {}
        for spec in descriptor['files']:
            file = record['files'].get(spec['sha256']) or record['files'].get(spec['role'])
            if not file or file['sha256'] != spec['sha256'] or file['role'] != spec['role']:
                raise ValueError(f'Incomplete or ambiguous file journal: {key}/{spec["sha256"]}')
            fid = file['id']
            old = resources.get(fid)
            row = dict(
                resource_id=old['resource_id'] if old else f'CONTENT-003/{key}/{fid}',
                paper_id=pid, paper_file_id=fid, paper_file_role=spec['role'],
                path=spec['path'], subject_id=descriptor['subject'], page_count=file['page_count'],
                downloaded_sha256=spec['sha256'], source_url=spec['source_url'],
                download_url=spec.get('download_url'), usage_scope='PERSONAL_ONLY',
                retrieved_on=spec.get('retrieved_on', as_of), imported_at=as_of, updated_at=as_of,
            )
            if old:
                for field in ('paper_id', 'paper_file_role', 'subject_id', 'page_count',
                              'downloaded_sha256', 'source_url', 'download_url'):
                    if old.get(field) != row[field]:
                        raise ValueError(f'Conflicting file provenance for {fid}: {field}')
            else:
                resources[fid] = row
            paper_resources[key][fid] = resources[fid]
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
        if item.get('answer_checked') is True:
            link['answer_checked'] = True
        if item.get('content_check'):
            link.update(content_check=item['content_check'], alternative_sources=item['alternative_sources'])
        review = db.execute("""
            SELECT verdict, checked_on, reviewer, evidence, expires_on
            FROM verification_record WHERE revision_id=? AND checked_on<=?
            ORDER BY checked_on DESC, id DESC LIMIT 1
        """, (rid, as_of)).fetchone()
        if review:
            verdict, checked_at, reviewer, evidence, expires = review
            if verdict == 'passed' and expires and expires < as_of:
                verdict = 'expired'
            link.update(review_status=verdict, checked_at=checked_at, reviewer=reviewer, evidence=evidence)
        key = item.get('paper_key')
        if key:
            files = paper_resources[key]
            original = chosen_file(files, item.get('original_file_id'), 'original')
            if 'original_file_id' in item:
                answer = chosen_file(files, item['answer_file_id'], 'answer') if item.get('answer_file_id') else None
                analysis = chosen_file(files, item['analysis_file_id'], 'analysis') if item.get('analysis_file_id') else None
            else:
                answer = chosen_file(files, None, 'answer')
                analysis = None if answer else chosen_file(files, None, 'analysis')
            ref = answer or analysis
            entry = dict(link, resource_id=original['resource_id'],
                         source_key=item['source_key'], regions=item['regions'],
                         **({'answer_resource_id': ref['resource_id']} if ref else {}))
            if answer and analysis:
                entry['analysis_resource_id'] = analysis['resource_id']
            merge_row(links, link_key, entry, ignore=dates)
        else:
            spec = item['source']
            entry = dict(link, kind=spec['kind'], source_id=f'{qid}/independent', path=spec['path'],
                         source_url=spec['url'], sha256=spec['sha256'], usage_scope='PERSONAL_ONLY')
            merge_row(sources, source_key, entry, ignore=dates)
    by_resource = indexed(resources.values(), lambda row: row['resource_id'])
    for link in links.values():
        entry = source_link(link, by_resource[link['resource_id']])
        merge_row(sources, source_key, entry, ignore=dates)
    trace.update(resources=list(resources.values()), links=list(links.values()),
                 question_sources=list(sources.values()), compositions=list(compositions.values()))
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
