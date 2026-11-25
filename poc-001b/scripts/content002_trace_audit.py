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


def readonly_uri(database):
    path = str(database.resolve(strict=True))
    if path.startswith('\\\\?\\UNC\\'):
        path = '\\\\' + path[8:]
    else:
        path = path.removeprefix('\\\\?\\')
    return Path(path).as_uri() + '?mode=ro'


def audit(database, trace, root, as_of, register=None, mode='scoped'):
    if type(trace['version']) is not int or trace['version'] not in (1, 2):
        raise ValueError("Expected trace version 1 or 2")
    if mode not in ('scoped', 'full'):
        raise ValueError("Expected scoped or full audit")
    root = root.resolve(strict=True)
    database = database.resolve(strict=True)
    with closing(sqlite3.connect(readonly_uri(database), uri=True)) as db:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        if db.execute("PRAGMA user_version").fetchone() != (9,):
            raise ValueError("Expected Schema 9")
        result = audit_snapshot(db, trace, root, as_of, database.parent)
        if trace['version'] == 2 or mode == 'full':
            check_inventory(db, trace, root, as_of, mode, result)
    if register is not None:
        with register.open(newline='', encoding='utf-8-sig') as stream:
            rows = list(csv.DictReader(stream))
        result['errors'].extend(check_register(trace['resources'], rows))
        if mode == 'full':
            resource_ids = {row['resource_id'] for row in trace['resources']}
            result['errors'].extend(
                {'code': 'imported_register_resource_unmapped', 'record': row['resource_id']}
                for row in rows if row['imported'] == 'yes' and row['resource_id'] not in resource_ids
            )
    for field in ('errors', 'pending'):
        result[field].sort(key=lambda row: json.dumps(row, sort_keys=True))
    return result


def link_key(row):
    return tuple(row.get(key) for key in ('question_id', 'revision_id', 'resource_id', 'source_key'))


def review_record(db, rid, as_of):
    return db.execute("""
            SELECT verdict, expires_on, checked_on, reviewer, evidence
            FROM verification_record WHERE revision_id = ? AND checked_on <= ?
            ORDER BY checked_on DESC, id DESC LIMIT 1
    """, (rid, as_of)).fetchone()


def review_status(review, as_of):
    if review is None:
        return 'unreviewed'
    if review[0] == 'passed' and review[1] and review[1] < as_of:
        return 'expired'
    return review[0]


def review_projection(db, rid, as_of):
    review = review_record(db, rid, as_of)
    projection = {'review_status': review_status(review, as_of)}
    if review:
        projection.update(dict(zip(('expires_on', 'checked_at', 'reviewer', 'evidence'), review[1:])))
        projection['review_history'] = [
            dict(zip(('id', 'verdict', 'expires_on', 'checked_at', 'reviewer', 'evidence', 'review_of'), record))
            for record in db.execute("""
                SELECT id, verdict, expires_on, checked_on, reviewer, evidence, review_of
                FROM verification_record WHERE revision_id=? AND checked_on<=?
                ORDER BY checked_on, id
            """, (rid, as_of))
        ]
    return projection


def review_matches(db, entry, as_of, lifecycle):
    expected = review_projection(db, entry['revision_id'], as_of)
    fields = ('review_status', 'checked_at', 'reviewer', 'evidence', 'expires_on', 'review_history')
    return all(entry.get(field) == expected.get(field) for field in fields
               if lifecycle or field in entry or field in fields[:4])


ENGLISH_LISTENING_ID = 'CONTENT-003.1/2024-new-curriculum-I/english/listening'


def english_material_status(trace, verified_supplements):
    result = {}
    for audio in trace.get('supplemental_resources', []):
        if audio['resource_id'] != ENGLISH_LISTENING_ID:
            continue
        pid = audio['paper_id']
        roles = {row['paper_file_role'] for row in trace['resources'] if row['paper_id'] == pid}
        # 'complete' is the existing material assessment; a PDF role alone proves only presence.
        assessed = trace.get('paper_quality', {}).get(pid) == 'complete'
        usable_external = audio['resource_id'] in verified_supplements and audio.get('status') == 'verified_external'
        result[pid] = {
            'material_scope': '2024_new_curriculum_I_practice',
            'paper_complete': assessed and 'original' in roles,
            'answer_complete': assessed and 'answer' in roles,
            'matching_external_audio': usable_external,
            'audio_match_status': 'verified_for_practice' if usable_external else 'needs_verification',
            'shandong_actual_exam_complete': 'needs_verification',
            'in_app_complete': False,
            'in_app_audio_support': 'BLOCKED',
            'public_redistribution': 'not_cleared',
        }
    return result


def check_inventory(db, trace, root, as_of, mode, result):
    def issue(code, record):
        result['errors'].append({'code': code, 'record': record})

    def compare(code, expected, actual):
        for record in sorted(expected - actual):
            issue(code, record)

    papers = dict(db.execute("SELECT id, subject_id FROM paper"))
    questions = dict(db.execute("SELECT original_id, logical_id FROM question_identity"))
    excluded = {'paper': set(), 'question': set()}
    accepted_exclusions = []
    for row in trace.get('exclusions', []):
        kind, key = row['kind'], row['id']
        inventory = {'paper': papers, 'question': questions}.get(kind, {})
        if key not in inventory or key in excluded[kind] or not row['evidence'].strip():
            issue('invalid_exclusion', key)
        else:
            excluded[kind].add(key)
            accepted_exclusions.append(row)
    scoped_papers = set(trace['paper_ids'])
    entries = trace.get('question_sources', [])
    mapped_questions = {row['question_id'] for row in entries}
    compare('excluded_paper_is_registered', excluded['paper'] & scoped_papers, set())
    compare('excluded_question_is_registered', excluded['question'] & mapped_questions, set())
    target_papers = set(papers) - excluded['paper'] if mode == 'full' else scoped_papers
    target_questions = set(questions) - excluded['question'] if mode == 'full' else mapped_questions
    compare('database_paper_unmapped', target_papers, scoped_papers)
    compare('database_question_unmapped', target_questions, mapped_questions)
    compare('registered_question_missing', mapped_questions, set(questions))
    revisions = {
        (qid, rid): json.loads(raw) for qid, rid, raw in
        db.execute("SELECT question_id, id, content_json FROM question_revision")
        if qid in target_questions
    }
    resources = {row['resource_id']: row for row in trace['resources']}
    pdf_links = {(row['question_id'], row['revision_id'], row['resource_id'], row['source_key'])
                 for row in trace['links']}
    source_ids = {}
    mapped_revisions = set()
    registered_pdf_links = set()
    valid_sources = defaultdict(list)
    bad_pairs = set()
    snapshot_errors = {row['record'] for row in result['errors'] if isinstance(row['record'], str)}
    invalid_links = {link_key(row) for index, row in enumerate(trace['links']) if f'link[{index}]' in snapshot_errors}
    for entry in entries:
        errors_before = len(result['errors'])
        qid, rid, sid = (entry[k] for k in ('question_id', 'revision_id', 'source_id'))
        pair = (qid, rid)
        identity = (qid, entry.get('resource_id'), entry.get('kind'), entry['source_url'], entry['sha256'],
                    entry.get('source_key'))
        if not sid or (sid in source_ids and source_ids[sid] != identity):
            issue('unstable_question_source_id', sid)
        source_ids[sid] = identity
        link = (qid, rid, sid)
        if link in mapped_revisions:
            issue('duplicate_question_source', link)
        mapped_revisions.add(link)
        content = revisions.get(pair)
        if content is None:
            issue('question_source_revision_missing', pair)
            continue
        url = urlsplit(entry['source_url'])
        if url.scheme not in ('http', 'https', 'file') or (url.scheme != 'file' and not url.netloc):
            issue('invalid_question_source_url', sid)
        if entry.get('usage_scope') != 'PERSONAL_ONLY':
            issue('invalid_question_source_scope', sid)
        if entry.get('kind') == 'paper':
            resource_id = entry['resource_id']
            key = (qid, rid, resource_id, entry.get('source_key'))
            registered_pdf_links.add(key)
            resource = resources.get(resource_id)
            if (not resource or key not in pdf_links or entry['sha256'] != resource['downloaded_sha256']
                    or entry['source_url'] != resource['source_url']):
                issue('question_paper_source_mismatch', pair)
        elif entry.get('kind') in ('web', 'screenshot', 'local', 'manual'):
            try:
                if digest(controlled_file(root, entry['path'])) != entry['sha256']:
                    issue('question_source_hash_mismatch', sid)
            except (OSError, ValueError):
                issue('question_source_missing', sid)
        else:
            issue('invalid_question_source_kind', sid)

        answer = complete(content, 'answer')
        fields = [has_content(part.get('analysis')) for part in content['parts'] or [content]]
        analysis = 'complete' if all(fields) else 'partial' if any(fields) else 'missing'
        review = review_record(db, rid, as_of)
        status = review_status(review, as_of)
        if (entry['answer_status'] != ('present' if answer else 'missing')
                or entry['analysis_status'] != analysis):
            issue('question_source_answer_or_analysis_mismatch', pair)
        if not review_matches(db, entry, as_of, trace.get('review_projection') == 1):
            issue('question_source_review_mismatch', pair)
        if status == 'passed' and not answer:
            issue('passed_question_without_answer', pair)
        if len(result['errors']) == errors_before and (entry['kind'] != 'paper' or
                (key not in invalid_links and resource_id not in snapshot_errors)):
            valid_sources[pair].append(entry)
        else:
            bad_pairs.add(pair)

    compare('database_revision_unmapped', set(revisions), {(q, r) for q, r, _ in mapped_revisions})
    if trace['version'] == 2:
        compare('paper_split_state_missing', scoped_papers, set(trace.get('paper_states', {})))
    compare('pdf_link_missing_question_source', pdf_links, registered_pdf_links)
    bad_pairs.update((q, r) for q, r, _, _ in pdf_links - registered_pdf_links)
    compare('database_file_unmapped_full',
            {fid for fid, pid in db.execute("SELECT id, paper_id FROM paper_file") if pid in target_papers},
            {row['paper_file_id'] for row in resources.values()})
    region_keys = {(row['question_id'], resources[row['resource_id']]['paper_file_id'], row['source_key'])
                   for row in trace['links'] if row['resource_id'] in resources}
    actual_regions = {
        (qid, fid, key) for pid, qid, fid, key in
        db.execute("SELECT paper_id, question_id, file_id, source_key FROM paper_region")
        if pid in target_papers or qid in target_questions
    }
    compare('database_region_unmapped_full', actual_regions, region_keys)
    incomplete_questions = {qid for qid, _, _ in actual_regions - region_keys}
    actual_occurrences = {
        (pid, qid, key) for pid, qid, key in
        db.execute("SELECT paper_id, question_id, source_key FROM question_occurrence")
        if pid in target_papers or qid in target_questions
    }
    mapped_occurrences = {(resources[row['resource_id']]['paper_id'], row['question_id'], row['source_key'])
                          for row in trace['links'] if row['resource_id'] in resources}
    compare('database_occurrence_unmapped_full', actual_occurrences, mapped_occurrences)
    incomplete_questions.update(qid for _, qid, _ in actual_occurrences - mapped_occurrences)
    compare('database_pin_unmapped_full', {
        (cid, pos, qid, rid) for cid, pos, qid, rid in
        db.execute("SELECT composition_id, position, question_id, revision_id FROM composition_item")
        if qid in target_questions
    }, {(pin['composition_id'], item['position'], item['question_id'], item['revision_id'])
        for pin in trace['compositions'] for item in pin['items']})
    supplements = set()
    for row in trace.get('supplemental_resources', []):
        key = row['resource_id']
        if key in supplements or key in resources or row.get('paper_id') not in scoped_papers:
            issue('invalid_supplement_identity', key)
            continue
        if (row.get('kind') != 'listening_audio' or row.get('usage_scope') != 'PERSONAL_ONLY'
                or urlsplit(row.get('source_url', '')).scheme != 'https'):
            issue('invalid_supplement_metadata', key)
            continue
        try:
            if digest(controlled_file(root, row['path'])) != row['sha256']:
                issue('supplement_hash_mismatch', key)
                continue
        except (OSError, ValueError):
            issue('supplement_missing_or_uncontrolled', key)
            continue
        supplements.add(key)
    if trace.get('supplemental_resources'):
        result['counts']['supplemental_resources_verified'] = len(supplements)
    materials = english_material_status(trace, supplements)
    if materials:
        complete_papers = {pid for pid in scoped_papers
                           if trace.get('paper_quality', {}).get(pid) == 'complete'}
        special = set(materials)
        result['material_status'] = list(materials.values())
        result['counts']['complete_material_sets'] = len(complete_papers - special) + sum(
            row['paper_complete'] and row['answer_complete'] and row['matching_external_audio']
            for row in materials.values())
        result['counts']['complete_sets_in_app'] = len(complete_papers - special) + sum(
            row['in_app_complete'] for row in materials.values())
    result['mode'] = mode
    result['counts'].update(database_papers=len(target_papers), database_question_records=len(target_questions),
                            database_revision_rows=len(revisions), registered_question_sources=len(source_ids),
                            excluded_papers=len(excluded['paper']), excluded_questions=len(excluded['question']))
    parents = dict(db.execute("SELECT id, base_revision_id FROM question_revision"))
    def bound_checks(row):
        rid = row['revision_id']
        return row.get('check_revision_id', rid if parents.get(rid) is None else None) == rid

    current = {(qid, rid) for qid, rid in db.execute("SELECT question_id,id FROM current_question_revision")
               if qid in target_questions}
    compare('database_current_revision_unmapped', current, {(q, r) for q, r, _ in mapped_revisions})
    # Count only the current revision of each canonical DEC-039 identity.
    logical_ids = {questions[q] for q in target_questions if q in questions}
    totals = Counter(dict.fromkeys((
        'canonical_with_answer', 'canonical_with_all_analysis_fields', 'canonical_analysis_checked',
        'canonical_answer_checked', 'canonical_review_passed', 'canonical_review_pending',
        'canonical_review_disputed', 'canonical_review_failed', 'canonical_source_complete',
        'canonical_content_disputed'
    ), 0))
    states = Counter()
    if mode == 'full':
        result['pending'] = [row for row in result['pending'] if 'review' not in row]
    reviewed_links = defaultdict(list)
    for link in trace['links']:
        if link_key(link) not in invalid_links:
            reviewed_links[link['question_id'], link['revision_id']].append(link)
    logical_count = 0
    for qid, rid, raw in db.execute('SELECT question_id,id,content_json FROM current_question_revision'):
        if qid not in logical_ids:
            continue
        logical_count += 1
        content = json.loads(raw)
        pair = (qid, rid)
        answer = complete(content, 'answer')
        analysis = complete(content, 'analysis')
        status = review_status(review_record(db, rid, as_of), as_of)
        source_complete = (bool(valid_sources[pair]) and pair not in bad_pairs
                           and qid not in incomplete_questions and qid not in excluded['question'])
        marks = [row for row in [*valid_sources[pair], *reviewed_links[pair]] if bound_checks(row)]
        totals['canonical_with_answer'] += answer
        totals['canonical_with_all_analysis_fields'] += analysis
        totals['canonical_analysis_checked'] += analysis and source_complete and any(row.get('analysis_checked') is True for row in marks)
        totals['canonical_answer_checked'] += answer and source_complete and any(row.get('answer_checked') is True for row in marks)
        totals['canonical_review_passed'] += status == 'passed'
        totals['canonical_review_pending'] += status in ('unreviewed', 'expired')
        totals['canonical_review_disputed'] += status == 'disputed'
        totals['canonical_review_failed'] += status == 'failed'
        totals['canonical_content_disputed'] += any(row.get('content_check') == 'disputed' for row in marks)
        totals['canonical_source_complete'] += source_complete
        states[status] += 1
        if mode == 'full' and (status != 'passed' or not answer or not analysis or not source_complete):
            result['pending'].append(dict(record=qid, revision_id=rid, review=status,
                answer_present=answer, analysis_fields_complete=analysis, source_complete=source_complete))
    result['counts'].update(totals, unique_logical_questions=logical_count,
                            database_current_logical_questions=logical_count)
    result['current_review_status'] = dict(states)
    result['historical_content_dispute_revisions'] = sorted({
        (row['question_id'], row['revision_id'])
        for row in [*trace['links'], *entries] if bound_checks(row) and row.get('content_check') == 'disputed'
    })
    result['legacy_checks_pending_verification'] = sorted({
        (row['question_id'], row['revision_id'])
        for row in [*trace['links'], *entries] if row.get('unverified_legacy_checks') or (not bound_checks(row) and any(
            row.get(field) for field in ('answer_checked', 'analysis_checked', 'content_check', 'alternative_sources')))
    })
    result['exclusions'] = accepted_exclusions


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
    if (trace['version'] == 1 and not scope) or len(scope) != len(set(scope)):
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
        for field, roles in [('answer_resource_id', ('answer', 'analysis')), ('analysis_resource_id', ('analysis',))]:
            if field in entry:
                ref = files.get(entry[field])
                if not ref or ref['paper_id'] != paper or ref['paper_file_role'] not in roles:
                    issue(field.removesuffix('_id')+'_mismatch', label)
        status = review_status(review_record(db, rev, as_of), as_of)
        if not review_matches(db, entry, as_of, trace.get('review_projection') == 1):
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
    paper_states = trace.get('paper_states', {})
    for paper, state in paper_states.items():
        if paper not in scope or state not in ('awaiting_split', 'partial', 'split_complete'):
            issue('invalid_paper_split_status', paper)
        elif (state == 'awaiting_split') != (paper not in linked_papers):
            issue('paper_split_status_mismatch', paper)
        elif state == 'awaiting_split':
            pending.append({'record': paper, 'split': state})
    for rid, resource in files.items():
        paper, fid = resource['paper_id'], resource['paper_file_id']
        if paper not in linked_papers and paper_states.get(paper) != 'awaiting_split':
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
    parser.add_argument('--mode', choices=('scoped', 'full'), default='scoped')
    parser.add_argument('--private-root', required=True, type=Path)
    parser.add_argument('--as-of', required=True, type=date.fromisoformat)
    options = parser.parse_args()
    try:
        trace = json.loads(options.trace.read_text(encoding='utf-8-sig'))
        result = audit(options.database, trace, options.private_root, options.as_of.isoformat(),
                       options.source_register, options.mode)
    except (OSError, ValueError, KeyError, IndexError, TypeError, sqlite3.Error) as exc:
        print(json.dumps({'errors': [{'code': 'input_or_database_error', 'message': str(exc)}]}))
        return 2
    print(json.dumps(result, indent=2, sort_keys=True))
    return 1 if result['errors'] else 0


if __name__ == '__main__':
    raise SystemExit(main())
