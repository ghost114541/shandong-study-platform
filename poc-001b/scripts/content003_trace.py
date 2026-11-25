"""Rebuild a private v2 provenance sidecar from a baseline and committed import journal."""
import argparse
from contextlib import closing
from copy import deepcopy
from datetime import date
import json
from pathlib import Path
from os import fsync, replace
from os.path import abspath
from tempfile import NamedTemporaryFile
import sqlite3

from content001_counts import complete, has_content
from content002_trace_audit import readonly_uri, review_projection


def private_output(path):
    path = Path(abspath(path))
    parent = path.parent.resolve(strict=True)
    repository = Path(__file__).resolve().parents[2]
    if parent != path.parent or parent.is_relative_to(repository) or any(
            (directory / '.git').exists() for directory in (parent, *parent.parents)):
        raise ValueError('Provenance output requires a private non-redirected directory')
    if path.is_symlink() or path.exists() and (
            path.resolve() != path or not path.is_file() or path.stat().st_nlink != 1):
        raise ValueError('Expected a private regular output file')
    return path


def write_trace(path, value):
    path = private_output(path)
    with NamedTemporaryFile(dir=path.parent, suffix='.tmp', delete=False,
                            mode='w', encoding='utf-8', newline='\n') as output:
        temporary = Path(output.name)
        try:
            json.dump(value, output, ensure_ascii=False, indent=2, sort_keys=True)
            output.write('\n')
            output.flush()
            fsync(output.fileno())
            output.close()
            replace(temporary, private_output(path))
            private_output(path)
        finally:
            temporary.unlink(missing_ok=True)


def load(path):
    return json.loads(path.read_text(encoding='utf-8-sig'))


REVIEW_FIELDS = ('review_status', 'checked_at', 'reviewer', 'evidence', 'expires_on', 'review_history')
CHECK_FIELDS = ('answer_checked', 'analysis_checked', 'content_check', 'alternative_sources')
SOURCE_FIELDS = ('question_id', 'paper_key', 'source_key', 'regions', 'source',
                 'original_file_id', 'answer_file_id', 'analysis_file_id')


def revision_entries(item):
    yield item
    source = {key: item[key] for key in SOURCE_FIELDS if key in item}
    for revision in item.get('extra_revisions', []):
        if not revision.get('revision_id') or revision['revision_id'] == item['revision_id']:
            raise ValueError('Additional checks require a distinct revision ID')
        if revision.get('question_id', item['question_id']) != item['question_id']:
            raise ValueError('Additional revision belongs to a different question')
        yield source | revision


def refresh_review(db, entry, as_of):
    for field in REVIEW_FIELDS:
        entry.pop(field, None)
    entry.update(review_projection(db, entry['revision_id'], as_of))


def apply_revision_checks(old, entry):
    checks = {field: entry[field] for field in CHECK_FIELDS if field in entry}
    unverified = {field: old[field] for field in CHECK_FIELDS if field in old
                  and old[field] != checks.get(field) and old[field] is not False}
    if unverified:
        records = old.setdefault('unverified_legacy_checks', [])
        if unverified not in records:
            records.append(unverified)
    for field in (*CHECK_FIELDS, 'check_revision_id'):
        old.pop(field, None)
    old.update(checks)
    if any(checks.values()):
        old['check_revision_id'] = old['revision_id']


def qualify_legacy_checks(db, entry):
    if not any(entry.get(field) for field in CHECK_FIELDS) or entry.get('check_revision_id') == entry['revision_id']:
        return
    row = db.execute('SELECT base_revision_id FROM question_revision WHERE id=? AND question_id=?',
                     (entry['revision_id'], entry['question_id'])).fetchone()
    if row == (None,) and 'check_revision_id' not in entry:
        entry['check_revision_id'] = entry['revision_id']
    else:
        apply_revision_checks(entry, {})


def source_link(link, resource):
    return dict(
        source_id=f"{link['question_id']}/{link['resource_id']}/{link['source_key']}",
        kind='paper', question_id=link['question_id'], revision_id=link['revision_id'],
        resource_id=link['resource_id'], source_url=resource['source_url'],
        sha256=resource['downloaded_sha256'], usage_scope='PERSONAL_ONLY',
        **{field: link[field] for field in (
            'source_key', 'answer_status', 'analysis_status',
        )},
        **{field: link[field] for field in (*REVIEW_FIELDS, *CHECK_FIELDS, 'check_revision_id', 'unverified_legacy_checks') if field in link and (field not in CHECK_FIELDS or link[field])},
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
    trace['review_projection'] = 1
    trace.setdefault('exclusions', [])
    trace['paper_states'] = {**dict.fromkeys(baseline['paper_ids'], 'partial'),
                             **baseline.get('paper_states', {})}
    trace.setdefault('paper_quality', {})
    trace['paper_ids'] = list(dict.fromkeys(trace['paper_ids']))
    resources = indexed(trace['resources'], file_key)
    links = indexed(trace['links'], link_key)
    def occurrence_key(row):
        return tuple(row[key] for key in ('question_id', 'resource_id', 'source_key'))

    occurrences = indexed(trace.get('paper_occurrences', []), occurrence_key)
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
    mutable = (*dates, *REVIEW_FIELDS, *CHECK_FIELDS, 'check_revision_id', 'unverified_legacy_checks')
    explicit_checks = {}
    explicit_links = set()
    for item in (revision for question in journal['questions'].values()
                 for revision in revision_entries(question)):
        qid = item['question_id']
        if item.get('occurrence_only'):
            if 'revision_id' in item or item.get('extra_revisions') or any(item.get(field) for field in CHECK_FIELDS):
                raise ValueError('An occurrence may not carry revision provenance or checks')
            original = chosen_file(paper_resources[item['paper_key']], item['original_file_id'], 'original')
            row = dict(question_id=qid, resource_id=original['resource_id'], source_key=item['source_key'],
                       regions=item['regions'], imported_at=as_of, updated_at=as_of)
            merge_row(occurrences, occurrence_key, row, ignore=dates)
            continue
        rid = item['revision_id']
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
            link.update(content_check=item['content_check'], alternative_sources=item.get('alternative_sources', []))
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
            merge_row(links, link_key, entry, ignore=mutable)
            if links[link_key(entry)].get('check_revision_id') != entry['revision_id']:
                apply_revision_checks(links[link_key(entry)], entry)
            explicit_links.add(link_key(entry))
            explicit_checks[source_key(source_link(entry, original))] = links[link_key(entry)]
        else:
            spec = item['source']
            entry = dict(link, kind=spec['kind'], source_id=f'{qid}/independent', path=spec['path'],
                         source_url=spec['url'], sha256=spec['sha256'], usage_scope='PERSONAL_ONLY')
            merge_row(sources, source_key, entry, ignore=mutable)
            explicit_checks[source_key(entry)] = entry
    for link in links.values():
        key = occurrence_key(link)
        occurrence = occurrences.pop(key, None)
        if occurrence is not None and occurrence['regions'] != link['regions']:
            raise ValueError(f'Conflicting occurrence regions for {key}')
    by_resource = indexed(resources.values(), lambda row: row['resource_id'])
    for key, link in links.items():
        if key not in explicit_links:
            qualify_legacy_checks(db, link)
        refresh_review(db, link, as_of)
        entry = source_link(link, by_resource[link['resource_id']])
        merge_row(sources, source_key, entry, ignore=mutable)
    for key, entry in sources.items():
        if key in explicit_checks:
            if entry.get('check_revision_id') != entry['revision_id']:
                apply_revision_checks(entry, explicit_checks[key])
            elif not any(entry.get(field) for field in CHECK_FIELDS):
                apply_revision_checks(entry, explicit_checks[key])
        else:
            qualify_legacy_checks(db, entry)
        refresh_review(db, entry, as_of)
    if occurrences or 'paper_occurrences' in trace:
        trace['paper_occurrences'] = list(occurrences.values())
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
    private_output(args.output)
    with closing(sqlite3.connect(readonly_uri(args.database), uri=True)) as db:
        db.execute('PRAGMA query_only=ON')
        db.execute('BEGIN')
        trace = rebuild(db, load(args.baseline), load(args.journal), args.as_of.isoformat())
    write_trace(args.output, trace)
