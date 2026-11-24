"""Collect explicitly selected public PDFs into a private workspace."""
import argparse
import json
import os
from pathlib import Path
import re
import shutil
import subprocess
import time
from urllib.parse import urlsplit

from content002_trace_audit import controlled_file, digest


def write_json(path, value):
    temp = path.with_suffix(path.suffix + '.tmp')
    with temp.open('w', encoding='utf-8') as stream:
        json.dump(value, stream, ensure_ascii=False, indent=2)
        stream.flush()
        os.fsync(stream.fileno())
    temp.replace(path)


def inspect_pdf(path):
    with path.open('rb') as stream:
        if stream.read(5) != b'%PDF-':
            raise ValueError('missing PDF header')
    result = subprocess.run(['pdfinfo', str(path)], capture_output=True, check=True, timeout=30)
    pages = re.search(rb'^Pages:\s+([1-9]\d*)\s*$', result.stdout, re.M)
    if not pages:
        raise ValueError('PDF has no verified page count')
    return dict(sha256=digest(path), bytes=path.stat().st_size, pages=int(pages[1]))


def collect(root, resources, resolve=()):
    records = []
    seen_hashes = {}
    seen_roles = {}
    for item in resources:
        start = time.monotonic()
        record = {**item, 'usage_scope': 'PERSONAL_ONLY', 'status': 'discovered'}
        records.append(record)
        try:
            name = item['path']
            if not name or Path(name).name != name:
                raise ValueError('expected a simple destination filename')
            target = root / name
            temporary = target.with_suffix('.download')
            if target.exists():
                metadata = inspect_pdf(controlled_file(root, name))
            else:
                if temporary.is_symlink() or target.is_symlink():
                    raise ValueError('unexpected symlink')
                if item.get('local_path'):
                    shutil.copyfile(item['local_path'], temporary)
                else:
                    url = item['download_url']
                    if urlsplit(url).scheme != 'https':
                        raise ValueError('expected HTTPS download')
                    cmd = ['curl.exe' if os.name == 'nt' else 'curl', '--fail', '--silent',
                           '--show-error', '--location', '--proto', '=https', '--proto-redir', '=https',
                           '--max-time', '60', '--max-filesize', str(64 * 1024**2),
                           '--retry', '2', '--retry-delay', '2', '--output', str(temporary)]
                    for address in resolve:
                        cmd.extend(['--resolve', address])
                    subprocess.run([*cmd, '--', url], capture_output=True, check=True)
                    time.sleep(0.4)
                metadata = inspect_pdf(temporary)
            for field in ('sha256', 'bytes', 'pages'):
                if field in item and item[field] != metadata[field]:
                    raise ValueError(f'{field} differs from declared value')
            if not target.exists():
                temporary.replace(target)
            record.update(metadata, status='awaiting_file_review')
            sha = metadata['sha256']
            if sha in seen_hashes:
                record['same_bytes_as'] = seen_hashes[sha]
            else:
                seen_hashes[sha] = item['id']
            key = (item['paper_key'], item['role'])
            if key in seen_roles and seen_roles[key][1] != sha:
                record['layout_candidate_of'] = seen_roles[key][0]
            else:
                seen_roles.setdefault(key, (item['id'], sha))
        except (OSError, ValueError, KeyError, subprocess.SubprocessError) as exc:
            record.update(status='needs_confirmation', error=type(exc).__name__)
        record['seconds'] = round(time.monotonic() - start, 3)
        write_json(root / 'collection.json', records)
    return records


if __name__ == '__main__':
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument('manifest', type=Path)
    parser.add_argument('private_root', type=Path)
    parser.add_argument('--resolve', action='append', default=[])
    args = parser.parse_args()
    root = args.private_root.resolve(strict=True)
    rows = collect(root, json.loads(args.manifest.read_text(encoding='utf-8-sig')), args.resolve)
    print(json.dumps(dict(resources=len(rows), pending=sum(r['status'] == 'needs_confirmation' for r in rows),
                          seconds=round(sum(r['seconds'] for r in rows), 3))))
    raise SystemExit(any(r['status'] == 'needs_confirmation' for r in rows))
