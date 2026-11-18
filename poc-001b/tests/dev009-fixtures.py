
"""Generate deterministic, original .studyzip fixtures using Python's standard library."""
import argparse
import collections
import hashlib
import json
import random
import struct
import warnings
import zipfile
import zlib
from pathlib import Path


def digest(data):
    return hashlib.sha256(data).hexdigest()


def json_bytes(value):
    return json.dumps(value, ensure_ascii=False, separators=(",", ":")).encode("utf-8")


def rows(records):
    return b"".join(json_bytes(record) + b"\n" for record in records)


def png(index):
    def chunk(kind, data):
        return struct.pack(">I", len(data)) + kind + data + struct.pack(">I", zlib.crc32(kind + data))
    pixel = bytes((index % 256, 100 + index // 256, 170))
    return (b"\x89PNG\r\n\x1a\n"
            + chunk(b"IHDR", struct.pack(">IIBBBBB", 8, 8, 8, 2, 0, 0, 0))
            + chunk(b"IDAT", zlib.compress((b"\0" + pixel * 8) * 8))
            + chunk(b"IEND", b""))


def pdf(text):
    stream = f"BT /F1 18 Tf 72 755 Td ({text}) Tj ET\n".encode()
    objects = [
        b"<< /Type /Catalog /Pages 2 0 R >>",
        b"<< /Type /Pages /Kids [3 0 R] /Count 1 >>",
        b"<< /Type /Page /Parent 2 0 R /MediaBox [0 0 595 842] /Contents 4 0 R /Resources << /Font << /F1 5 0 R >> >> >>",
        b"<< /Length %d >>\nstream\n" % len(stream) + stream + b"endstream",
        b"<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>",
    ]
    data = bytearray(b"%PDF-1.4\n")
    offsets = [0]
    for index, obj in enumerate(objects, 1):
        offsets.append(len(data))
        data.extend(f"{index} 0 obj\n".encode() + obj + b"\nendobj\n")
    xref = len(data)
    data.extend(f"xref\n0 {len(offsets)}\n0000000000 65535 f \n".encode())
    for offset in offsets[1:]:
        data.extend(f"{offset:010} 00000 n \n".encode())
    data.extend(f"trailer\n<< /Size {len(offsets)} /Root 1 0 R >>\nstartxref\n{xref}\n%%EOF\n".encode())
    return bytes(data)


def doc(text, photo=None, formula=False):
    inlines = [{"type": "text", "text": text}]
    if formula:
        inlines.append({"type": "inlineMath", "attrs": {"latex": "x^2+3x-10=0"}})
    blocks = [{"type": "paragraph", "content": inlines}]
    if photo:
        blocks.append({"type": "image", "attrs": {"src": "attachment:" + photo, "alt": "合成配图"}})
    return {"type": "doc", "content": blocks}


def contents(pack_id, version, questions, file_images, paper_count, fault=None):
    upgraded = version == "1.1.0"
    subject_ids = ["math"] if questions < 10 else ["math", "physics", "chemistry", "history"]
    records = {}
    members = {}
    image_info = []
    for index in range(file_images):
        pixels = b"invalid image fixture" if fault == "image" and index == 0 else png(index)
        sha = digest(pixels)
        members[f"attachments/{sha}.png"] = ("image", pixels)
        image_info.append(dict(id=f"sha256-{sha}", sha256=sha, byte_size=len(pixels), media_type="image/png"))

    points = []
    for i, subject in enumerate(subject_ids):
        parent = f"kp009-{subject}"
        point_title = "资源包演示知识点新版" if upgraded else "资源包演示知识点"
        points.append(dict(id=parent, subject_id=subject, title=f"{point_title} {subject}", parent_id=None,
                           sort_order=i, aliases=["公共新别名" if upgraded else "公共首版别名"], rights_id="original"))
        points.append(dict(id=parent + "-child", subject_id=subject, title=f"公共子节点 {subject}",
                           parent_id=parent, sort_order=i, aliases=[], rights_id="original"))
    if fault == "parent":
        points[1]["parent_id"] = "missing-parent"
    if fault == "cycle":
        points[0]["parent_id"] = points[1]["id"]
    records["knowledge"] = points

    bank = []
    for i in range(questions):
        subject = subject_ids[i % len(subject_ids)]
        image = image_info[i] if i < len(image_info) else None
        title = f"资源包新版检索题 {i:04d}" if upgraded else f"资源包首版检索题 {i:04d}"
        if fault == "conflict":
            title = "不同字节的同版本题"
        content = dict(schema_version=1, question_type="解答题", score=4,
                       stem=doc(title, image and image["id"], True), answer=doc("答案 2 和 -5"),
                       analysis=doc("先因式分解，再检验。"), attachments=[image] if image else [], parts=[
                           dict(id="a", score=4, prompt=doc("求方程的根。"), answer=doc("2 和 -5"), analysis=None)
                       ])
        bank.append(dict(id=f"kp009-q-{i:04d}", subject_id=subject,
                         revision="rev2" if upgraded else "rev1", content=content,
                         knowledge=[f"kp009-{subject}-child"], rights_id="original"))
    if fault == "knowledge":
        bank[0]["knowledge"] = ["missing-point"]
    if fault == "attachment":
        info = bank[0]["content"]["attachments"][0]
        members.pop(f"attachments/{info['sha256']}.png")
        file_images -= 1
    if fault == "duplicate-id":
        bank.append(bank[0])
    if fault == "same-revision":
        bank[0]["revision"] = "rev1"
    records["questions"] = bank

    papers = []
    for i in range(paper_count):
        files = []
        for role in ["original", "answer", "analysis"]:
            text = f"KnowPaper DEV-009 synthetic {role.upper()} {i+1} {version}"
            raw = b"invalid PDF fixture" if fault == "pdf" and role == "original" else pdf(text)
            sha = digest(raw)
            members[f"paper-pdfs/{sha}.pdf"] = ("pdf", raw)
            files.append(dict(role=role, sha256=sha, name=f"合成{role}-{i+1}.pdf", rights_id="original"))
        index = i % questions
        papers.append(dict(id=f"kp009-paper-{i:03d}", subject_id=bank[index]["subject_id"],
                           title=f"DEV-009 合成试卷 {i + 1}{' 新版' if upgraded else ''}",
                           metadata=dict(year=2027 if upgraded else 2026, region="山东演示", source="原创生成"),
                           files=files, occurrences=[dict(
                               source_key="1", question_id=bank[index]["id"],
                               regions=[dict(page_index=0, rect=[0.1, 0.1, 0.8, 0.3])])], rights_id="original"))
    records["papers"] = papers

    for key, data in records.items():
        namespace = {"knowpaper.medium": b"kp009m-", "knowpaper.large": b"kp009l-"}.get(pack_id, b"kp009-")
        members[f"data/{key}.jsonl"] = (key, rows(data).replace(b"kp009-", namespace))
    rights_path = "LICENSES/rights-and-attribution.json"
    members[rights_path] = ("rights", json_bytes({"entries": [dict(
        id="original", source="DEV-009 合成样本", author="KnowPaper 测试脚本",
        license="CC0-1.0", statement="本包仅用于 KnowPaper 技术验收，所有图像、题目和试卷均由脚本生成。",
        redistribution_claimed=True, scope="本测试归档内的合成资源", evidence="tests/dev009-fixtures.py",
    )]}))
    roles = collections.Counter(role for role, _ in members.values())
    manifest = dict(format="shandong-study-resource-pack", protocol_version=1, pack_id=pack_id,
                    pack_version=version, display_name="DEV-009 原创离线资源包", source="KnowPaper 合成验收样本",
                    min_app_version="0.1.0", db_schema=8, content_version=1,
                    counts={**{key: len(data) for key, data in records.items()}, "images": file_images, "pdfs": roles["pdf"]},
                    license_manifest=rights_path, files=[
                        dict(path=path, role=role, bytes=len(raw), sha256=digest(raw))
                        for path, (role, raw) in sorted(members.items())
                    ])
    return manifest, members


def make(output, name, pack_id="knowpaper.fixture", version="1.0.0", questions=4, images=1, papers=1, fault=None):
    manifest, members = contents(pack_id, version, questions, images, papers, fault)
    named = {key: raw for key, (_, raw) in sorted(members.items())}
    if fault == "hash":
        manifest["files"][0]["sha256"] = "a" * 64
    if fault == "size":
        manifest["files"][0]["bytes"] += 1
    if fault == "missing":
        named.pop("data/knowledge.jsonl")
    if fault == "extra":
        named["extra.txt"] = b"unlisted"
    for field, replacement in {"protocol": ("protocol_version", 2), "schema": ("db_schema", 9),
                               "app": ("min_app_version", "10.0.0"), "content": ("content_version", 2),
                               "format": ("format", "unknown"), "version": ("pack_version", "01.0.0")}.items():
        if fault == field:
            manifest[replacement[0]] = replacement[1]
    if fault != "missing-manifest":
        raw = json_bytes(manifest)
        if fault == "json":
            raw = b"{"
        if fault == "duplicate-key":
            raw = b'{"pack_id":"duplicate",' + raw[1:]
        named = {"manifest.json": raw, **named}
    filename = output / f"{name}.studyzip"
    with warnings.catch_warnings():
        warnings.filterwarnings("ignore", message="Duplicate name:")
        with zipfile.ZipFile(filename, "w", compression=zipfile.ZIP_DEFLATED) as archive:
            for path, data in named.items():
                info = zipfile.ZipInfo(path, date_time=(2026, 11, 18, 0, 0, 0))
                # Stored members also support highly repetitive synthetic collections
                # without crossing the reader's compression ratio threshold.
                info.compress_type = zipfile.ZIP_STORED if len(data) > 300_000 else zipfile.ZIP_DEFLATED
                archive.writestr(info, data)
            if fault in {"traversal", "absolute", "drive", "unc", "reserved", "case", "overlap"}:
                unsafe_name = {
                    "traversal": "../outside", "absolute": "/outside", "drive": "C:/outside",
                    "unc": "\\\\server\\share\\outside", "reserved": "data/CON.txt",
                    "case": "Manifest.json", "overlap": "data",
                }[fault]
                archive.writestr(unsafe_name, b"unsafe name fixture")
            if fault in {"link", "fifo"}:
                special = zipfile.ZipInfo("data/special")
                special.create_system = 3
                special.external_attr = (0o120777 if fault == "link" else 0o010644) << 16
                archive.writestr(special, b"../outside")
            if fault == "duplicate-path":
                archive.writestr("manifest.json", b"duplicate")
            if fault == "ratio":
                archive.writestr("extra.bin", b"\0" * 1024 * 1024)
            if fault == "member-count":
                for index in range(4097):
                    archive.writestr(f"many/{index}", b".")
            if fault == "member-size":
                archive.writestr("large.bin", b"\0" * (64 * 1024 * 1024 + 1))
            if fault == "total-size":
                rng = random.Random(9)
                payload = b"".join(b"\0" * 32256 + rng.randbytes(512) for _ in range(58 * 32))
                for index in range(9):
                    archive.writestr(f"total/{index}", payload, compresslevel=1)
    if name == "small":
        (output / "manifest.example.json").write_text(
            json.dumps(manifest, ensure_ascii=False, indent=2) + "\n", encoding="utf-8")
    with zipfile.ZipFile(filename) as archive:
        return dict(name=name, bytes=filename.stat().st_size, members=len(archive.infolist()),
                    uncompressed=sum(member.file_size for member in archive.infolist()),
                    sha256=digest(filename.read_bytes()))


def generate(output, all_cases):
    output.mkdir(parents=True, exist_ok=True)
    records = [make(output, "small"), make(output, "upgrade", version="1.1.0", questions=5),
               make(output, "crash", pack_id="knowpaper.crash", questions=4),
               make(output, "case-corrupt", fault="hash"),
               make(output, "medium", pack_id="knowpaper.medium", questions=500, images=30, papers=8),
               make(output, "large", pack_id="knowpaper.large", questions=2000, images=64, papers=20)]
    if all_cases:
        records.append(make(output, "same-revision-reused", version="1.0.1"))
        for fault in ["conflict", "image", "pdf", "parent", "cycle", "knowledge", "attachment", "duplicate-id",
                      "size", "missing", "extra", "protocol", "schema", "app", "content", "format", "version",
                      "missing-manifest", "json", "duplicate-key", "traversal", "absolute", "drive", "unc",
                      "reserved", "case", "overlap", "link", "fifo", "duplicate-path", "ratio", "member-count", "member-size", "total-size"]:
            records.append(make(output, "case-" + fault, fault=fault))
        records.append(make(output, "case-same-revision", version="1.1.0", fault="same-revision"))
    (output / "fixture-inventory.json").write_text(json.dumps(records, indent=2) + "\n", encoding="utf-8")


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("output", type=Path)
    parser.add_argument("--all", action="store_true")
    args = parser.parse_args()
    generate(args.output, args.all)
