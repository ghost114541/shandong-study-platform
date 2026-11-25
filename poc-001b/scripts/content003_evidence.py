"""Verify and unpack an application backup, and compare retained baseline rows."""
import argparse
from collections import Counter
from contextlib import closing
import hashlib
import json
from pathlib import Path, PurePosixPath
import shutil
import sqlite3
from zipfile import ZipFile

from content002_trace_audit import controlled_file, digest, readonly_uri

RETAINED = (
    'question', 'question_revision', 'question_occurrence', 'paper', 'paper_file',
    'paper_region', 'composition', 'composition_item', 'question_knowledge',
)


def unpack(backup, target):
    with ZipFile(backup) as archive:
        manifest = json.loads(archive.read('manifest.json'))
        if (manifest['format'], manifest['version'], manifest['schema_version']) != ('knowpaper-backup', 1, 9):
            raise ValueError('Expected a version 1 Schema 9 application backup')
        names = archive.namelist()
        expected = set(row['path'] for row in manifest['files'])
        if set(names) != expected | {'manifest.json'} or len(names) != len(expected) + 1:
            raise ValueError('Archive member mismatch')
        if manifest['file_count'] != len(expected) or len(manifest['files']) != len(expected):
            raise ValueError('Manifest member mismatch')
        if sum(row['bytes'] for row in manifest['files']) != manifest['total_bytes']:
            raise ValueError('Manifest size mismatch')
        target.mkdir(exist_ok=False)
        for row in manifest['files']:
            name = row['path']
            member = PurePosixPath(name)
            if not name or '\\' in name or ':' in name or member.is_absolute() or '..' in member.parts:
                raise ValueError('Nonportable archive path')
            destination = target.joinpath(*member.parts)
            destination.parent.mkdir(parents=True, exist_ok=True)
            if archive.getinfo(name).file_size != row['bytes']:
                raise ValueError('Archive size mismatch')
            with archive.open(name) as source, destination.open('xb') as output:
                shutil.copyfileobj(source, output)
            if digest(destination) != row['sha256']:
                raise ValueError('Archive hash mismatch')
        if digest(target / 'study.sqlite3') != manifest['database_sha256']:
            raise ValueError('Database digest mismatch')
    return manifest['file_count']


def retained(before, after):
    def open_read(path):
        return closing(sqlite3.connect(readonly_uri(path), uri=True))

    counts = {}
    with open_read(before) as old, open_read(after) as new:
        for table in RETAINED:
            rows = set(old.execute(f'SELECT * FROM {table}'))
            if not rows <= set(new.execute(f'SELECT * FROM {table}')):
                raise ValueError(f'Baseline rows changed in {table}')
            counts[table] = len(rows)
    return counts


def fingerprint(root, paths):
    root = root.resolve(strict=True)
    return {name:digest(controlled_file(root, name)) for name in sorted(set(paths))}


def compare_business_state(before, after, backup):
    """Check the logical database and the actual members after app restore/restart."""
    def connect(root):
        return sqlite3.connect(readonly_uri(root / 'study.sqlite3'), uri=True)

    def tables(db):
        return {name for name, in db.execute("SELECT name FROM sqlite_schema WHERE type='table'")
                if not name.startswith('sqlite_') and name != 'backup_record'}

    with closing(connect(before)) as original, closing(connect(after)) as restored:
        for db in (original, restored):
            db.execute('BEGIN')
            if db.execute('PRAGMA user_version').fetchone() != (9,):
                raise ValueError('Expected Schema 9')
        business_tables = tables(original)
        if business_tables != tables(restored):
            raise ValueError('Business table inventory differs')
        for table in sorted(business_tables):
            sql = 'SELECT * FROM "' + table.replace('"', '""') + '"'
            if Counter(original.execute(sql)) != Counter(restored.execute(sql)):
                raise ValueError(f'Business records differ: {table}')

    with ZipFile(backup) as archive:
        entries = json.loads(archive.read('manifest.json'))['files']
    paths = [row['path'] for row in entries if row['path'] != 'study.sqlite3']
    if fingerprint(before, paths) != fingerprint(after, paths):
        raise ValueError('Restored resource bytes differ')
    return {'business_tables_equal':len(business_tables), 'resource_files_equal':len(paths)}


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('backup', type=Path)
    parser.add_argument('target', type=Path)
    parser.add_argument('--before', type=Path)
    parser.add_argument('--compare-library', type=Path, help='Active library after a verified restore')
    args = parser.parse_args()
    count = unpack(args.backup, args.target)
    result = {'members_verified':count}
    if args.before:
        result['retained_rows'] = retained(args.before, args.target / 'study.sqlite3')
    if args.compare_library:
        result.update(compare_business_state(args.target, args.compare_library, args.backup))
    print(json.dumps(result, sort_keys=True))
