"""Audit an explicitly selected Schema 9 library and its private provenance sidecar."""
import argparse
from collections import Counter, defaultdict
from contextlib import closing
import csv
from datetime import date
import hashlib
import json
from pathlib import Path
import re
import sqlite3
from urllib.parse import urlsplit

from content001_counts import complete, has_content


def controlled_file(root, relative):
    path = Path(relative)
    if path.anchor or '..' in path.parts:
        raise ValueError("A controlled file must use a relative path")
    resolved = (root / path).resolve(strict=True)
    if not resolved.is_relative_to(root) or not resolved.is_file():
        raise ValueError("File is outside the controlled directory or is not a regular file")
    return resolved


def digest(path):
    with path.open('rb') as stream:
        return hashlib.file_digest(stream, 'sha256').hexdigest()


def check_register(resources, rows):
    registered = defaultdict(list)
    errors = []
    for row in rows:
        registered[row['resource_id']].append(row)
    for rid, records in registered.items():
        if len(records) != 1:
            errors.append({'code': 'duplicate_register_id', 'record': rid})
    for entry in resources:
        rid = entry['resource_id']
        if rid not in registered:
            errors.append({'code': 'resource_absent_from_register', 'record': rid})
            continue
        row = registered[rid][0]
        if (row['source_url'] != entry['source_url']
            or row['sha256'] != entry['downloaded_sha256']
            or row['imported'] != 'yes'
            or row['usage_scope'] != entry['usage_scope']
            or row['retrieved_on'] != entry['retrieved_on']
            or (entry.get('download_url') and entry['download_url'] != (row['file_url'] or row['source_url']))):
            errors.append({'code': 'resource_register_mismatch', 'record': rid})
    return errors


def audit(database, trace, root, as_of, register=None):
    if type(trace['version']) is not int or trace['version'] != 1:
        raise ValueError("Expected trace version 1")
    root = root.resolve(strict=True)
    database = database.resolve(strict=True)
    uri = Path(str(database).removeprefix('\\\\?\\')).as_uri() + '?mode=ro'
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        if db.execute("PRAGMA user_version").fetchone() != (9,):
            raise ValueError("Expected Schema 9")
        result = audit_snapshot(db, trace, root, as_of, database.parent)
    if register is not None:
        with register.open(newline='', encoding='utf-8-sig') as stream:
            result['errors'].extend(check_register(trace['resources'], csv.DictReader(stream)))
    return result


def audit_snapshot(db, trace, root, as_of, library):
    errors = []
    pending = []
    counts = Counter()
    files = {}
    revisions = defaultdict(set)
    current = {}
    logical_current = {}

    def issue(code, record):
        errors.append({'code': code, 'record': record})

    def one(sql, *args):
        return db.execute(sql, args).fetchone()

    def check_file(base, relative, expected, size, rid, kind):
        try:
            path = controlled_file(base, relative)
            if path.stat().st_size != size or digest(path) != expected:
                issue(kind + '_hash_mismatch', rid)
        except (OSError, ValueError):
            issue(kind + '_file_missing_or_uncontrolled', rid)

    resource_ids = Counter(entry['resource_id'] for entry in trace['resources'])
    file_ids = Counter(entry['paper_file_id'] for entry in trace['resources'])
    for rid, count in resource_ids.items():
        if count != 1:
            issue('duplicate_resource_id', rid)
    def metadata_dates(entry, record, *keys):
        for key in keys:
            value = entry.get(key)
            try:
                if date.fromisoformat(value).isoformat() == value:
                    continue
            except (TypeError, ValueError):
                pass
            issue('missing_or_invalid_' + key, record)

    for entry in trace['resources']:
        rid, fid = entry['resource_id'], entry['paper_file_id']
        metadata_dates(entry, rid, 'retrieved_on', 'imported_at', 'updated_at')
        for key in ('source_url', 'download_url'):
            if key == 'download_url' and not entry.get(key):
                continue
            url = urlsplit(entry[key])
            if url.scheme not in ('http', 'https') or not url.netloc:
                issue('invalid_source_url', rid)
        if entry['usage_scope'] != 'PERSONAL_ONLY':
            issue('invalid_usage_scope', rid)
        if file_ids[fid] > 1:
            issue('duplicate_paper_file_mapping', rid)
        subject = one("SELECT subject_id FROM paper WHERE id = ?", entry['paper_id'])
        if not subject:
            issue('paper_missing', rid)
        elif subject != (entry['subject_id'],):
            issue('paper_subject_mismatch', rid)
        row = one("SELECT paper_id, role, sha256, byte_size, page_count FROM paper_file WHERE id = ?", fid)
        if not row or row[:2] != (entry['paper_id'], entry['paper_file_role']):
            issue('paper_file_or_role_mismatch', rid)
            continue
        expected = entry['downloaded_sha256']
        if not re.fullmatch('[0-9a-f]{64}', expected) or expected != row[2]:
            issue('registered_hash_mismatch', rid)
        if type(entry['page_count']) is not int or entry['page_count'] != row[4]:
            issue('file_page_count_mismatch', rid)
        check_file(root, entry['path'], row[2], row[3], rid, 'private')
        check_file(library.resolve(), f'paper-pdfs/{row[2][:2]}/{row[2]}', row[2], row[3], rid, 'library')
        files[rid] = entry
        counts['pdf_resources'] += 1

    scope = trace['paper_ids']
    if not scope or len(scope) != len(set(scope)):
        issue('invalid_paper_scope', 'paper_ids')
    for paper in set(scope) | {entry['paper_id'] for entry in files.values()}:
        if paper not in scope:
            issue('paper_outside_scope', paper)
        if not any(entry['paper_id'] == paper and entry['paper_file_role'] == 'original'
                   for entry in files.values()):
            issue('scoped_original_missing', paper)

    linked_papers = set()
    linked_occurrences = set()
    seen = set()
    for index, entry in enumerate(trace['links']):
        rid, qid, rev, key = (entry[k] for k in ('resource_id', 'question_id', 'revision_id', 'source_key'))
        label = f'link[{index}]'
        metadata_dates(entry, label, 'imported_at', 'updated_at')
        identity = (rid, key, qid, rev)
        if identity in seen:
            issue('duplicate_link', label)
        seen.add(identity)
        resource = files.get(rid)
        if not resource or resource['paper_file_role'] != 'original':
            issue('orphan_link', label)
            continue
        paper, fid, subject = (resource[k] for k in ('paper_id', 'paper_file_id', 'subject_id'))
        logical = one("SELECT logical_id, subject_id FROM question_identity WHERE original_id = ?", qid)
        if not logical:
            issue('question_missing', label)
            continue
        if logical[1] != subject:
            issue('question_subject_mismatch', label)
        row = one("SELECT question_id, content_json FROM question_revision WHERE id = ?", rev)
        if type(rev) is not int or not row or row[0] != qid:
            issue('revision_missing_or_wrong_owner', label)
            continue
        if one("SELECT question_id FROM question_occurrence WHERE paper_id = ? AND source_key = ?", paper, key) != (qid,):
            issue('occurrence_mismatch', label)
            continue
        linked_papers.add(paper)
        linked_occurrences.add((paper, key, qid))
        region_rows = list(db.execute("""
            SELECT page_index, x0, y0, x1, y1 FROM paper_region
            WHERE paper_id = ? AND file_id = ? AND source_key = ? AND question_id = ? ORDER BY ordinal
        """, (paper, fid, key, qid)))
        regions = entry['regions']
        if not regions or any(
            type(r['page_index']) is not int or not 0 <= r['page_index'] < resource['page_count']
            for r in regions
        ):
            issue('page_out_of_range_or_empty', label)
        if region_rows != [(r['page_index'], *r['rect']) for r in regions]:
            issue('region_mismatch', label)
        revisions[(rid, key, qid)].add(rev)
        content = json.loads(row[1])
        answer = complete(content, 'answer')
        analyses = [has_content(part.get('analysis')) for part in (content['parts'] or [content])]
        analysis = 'complete' if all(analyses) else 'partial' if any(analyses) else 'missing'
        if entry['answer_status'] not in ('present', 'missing', 'pending') or (
            entry['answer_status'] != 'pending' and answer != (entry['answer_status'] == 'present')
        ):
            issue('answer_status_mismatch', label)
        if entry['analysis_status'] not in (analysis, 'pending'):
            issue('analysis_status_mismatch', label)
        if 'answer_resource_id' in entry:
            answer_file = files.get(entry['answer_resource_id'])
            if not answer_file or answer_file['paper_id'] != paper or answer_file['paper_file_role'] not in ('answer', 'analysis'):
                issue('answer_resource_mismatch', label)
        review = one("""
            SELECT verdict, checked_on, reviewer, evidence, expires_on
            FROM verification_record WHERE revision_id = ? AND checked_on <= ?
            ORDER BY checked_on DESC, id DESC LIMIT 1
        """, rev, as_of)
        status = review[0] if review else 'unreviewed'
        if review and status == 'passed' and review[4] and review[4] < as_of:
            status = 'expired'
        metadata = tuple(entry.get(k) for k in ('checked_at', 'reviewer', 'evidence'))
        if entry['review_status'] != status or (review and metadata != review[1:4]) or (
            not review and any(value is not None for value in metadata)
        ) or (status == 'passed' and not answer):
            issue('review_status_or_evidence_mismatch', label)
        active = one("SELECT id FROM current_question_revision WHERE question_id = ?", qid)
        if active == (rev,):
            current[qid] = (answer, analysis, status)
            if logical[0] == qid:
                logical_current[qid] = current[qid]
            if status != 'passed' or not answer or analysis != 'complete':
                pending.append({'record': label, 'answer_present': answer, 'analysis_fields': analysis, 'review': status})

    for (rid, key, qid), mapped in revisions.items():
        active = one("SELECT id FROM current_question_revision WHERE question_id = ?", qid)
        label = f"{rid}/{key}/{qid}"
        if not active or active[0] not in mapped:
            issue('current_revision_unmapped', label)
        if active:
            ancestry = db.execute("""
                WITH RECURSIVE ancestors(id, base) AS (
                    SELECT id, base_revision_id FROM question_revision WHERE id = ?
                    UNION
                    SELECT r.id, r.base_revision_id FROM question_revision r JOIN ancestors a ON r.id = a.base
                ) SELECT id FROM ancestors
            """, active).fetchall()
            if any(rev != active[0] and rev not in mapped for (rev,) in ancestry):
                issue('revision_history_gap', label)
    for rid, resource in files.items():
        paper, fid = resource['paper_id'], resource['paper_file_id']
        if paper not in linked_papers:
            issue('orphan_resource', rid)
        if resource['paper_file_role'] == 'original':
            for key, qid in db.execute("""
                SELECT DISTINCT source_key, question_id FROM paper_region WHERE file_id = ?
            """, (fid,)):
                if (rid, key, qid) not in revisions:
                    issue('database_region_unmapped', f'{rid}/{key}/{qid}')
            for (other,) in db.execute("SELECT id FROM paper_file WHERE paper_id = ?", (paper,)):
                if other not in file_ids:
                    issue('database_file_unmapped', other)

    for paper in set(scope):
        for key, qid in db.execute("SELECT source_key, question_id FROM question_occurrence WHERE paper_id = ?", (paper,)):
            if (paper, key, qid) not in linked_occurrences:
                issue('database_occurrence_unmapped', f'{paper}/{key}/{qid}')

    pin_ids = set()
    for pin in trace['compositions']:
        cid = pin['composition_id']
        if cid in pin_ids:
            issue('duplicate_composition_snapshot', cid)
        pin_ids.add(cid)
        expected = [(r['position'], r['question_id'], r['revision_id']) for r in pin['items']]
        actual = list(db.execute("""
            SELECT i.position, i.question_id, i.revision_id
            FROM composition_item i JOIN question_revision r ON r.id = i.revision_id AND r.question_id = i.question_id
            WHERE i.composition_id = ? ORDER BY i.position
        """, (cid,)))
        count = one("SELECT count(*) FROM composition_item WHERE composition_id = ?", cid)[0]
        if not expected or expected != actual or count != len(actual) or not one("SELECT 1 FROM composition WHERE id = ?", cid):
            issue('composition_pin_mismatch', cid)
        counts['fixed_items'] += len(actual)
    for qid in current:
        for (cid,) in db.execute("SELECT DISTINCT composition_id FROM composition_item WHERE question_id = ?", (qid,)):
            if cid not in pin_ids:
                issue('composition_snapshot_missing', cid)

    identities = {one("SELECT logical_id FROM question_identity WHERE original_id = ?", qid)[0] for qid in current}
    for qid in identities - logical_current.keys():
        pending.append({'record': qid, 'review': 'canonical_current_revision_outside_trace'})
    counts.update(occurrences=len(linked_occurrences), revision_links=len(seen), unique_logical_questions=len(identities),
                  canonical_with_answer=sum(v[0] for v in logical_current.values()),
                  canonical_with_all_analysis_fields=sum(v[1] == 'complete' for v in logical_current.values()),
                  canonical_review_passed=sum(v[2] == 'passed' for v in logical_current.values()))
    return {'schema': 9, 'as_of': as_of, 'counts': dict(counts), 'errors': errors, 'pending': pending}


def main():
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('database', type=Path)
    parser.add_argument('trace', type=Path)
    parser.add_argument('--source-register', type=Path)
    parser.add_argument('--private-root', required=True, type=Path)
    parser.add_argument('--as-of', required=True, type=date.fromisoformat)
    options = parser.parse_args()
    try:
        trace = json.loads(options.trace.read_text(encoding='utf-8-sig'))
        result = audit(options.database, trace, options.private_root, options.as_of.isoformat(), options.source_register)
    except (OSError, ValueError, KeyError, IndexError, TypeError, sqlite3.Error) as exc:
        print(json.dumps({'errors': [{'code': 'input_or_database_error', 'message': str(exc)}]}))
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 1 if result['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
