"""Read aggregate inventory from one explicitly selected Schema 9 library."""
import argparse
from collections import Counter
from contextlib import closing
from datetime import date
import json
from pathlib import Path
import sqlite3


def has_content(node):
    if not isinstance(node, dict):
        return False
    if node.get("type") in {"image", "blockMath", "inlineMath"}:
        return True
    text = node.get("text")
    return (isinstance(text, str) and bool(text.strip())) or any(
        has_content(child) for child in node.get("content", [])
    )


def complete(content, field):
    return all(has_content(part.get(field)) for part in (content["parts"] or [content]))


def inventory(path, as_of):
    resolved = path.resolve(strict=True)
    if resolved.drive.startswith("\\\\?\\") and resolved.drive.endswith(":"):
        resolved = Path(str(resolved).removeprefix("\\\\?\\"))
    uri = resolved.as_uri() + "?mode=ro"
    with closing(sqlite3.connect(uri, uri=True)) as db:
        db.execute("PRAGMA query_only=ON")
        db.execute("BEGIN")
        schema = db.execute("PRAGMA user_version").fetchone()[0]
        if schema != 9:
            raise ValueError(f"Expected Schema 9, got {schema}")

        def count(table):
            return db.execute(f"SELECT count(*) FROM {table}").fetchone()[0]

        questions = Counter()
        statuses = Counter()
        subjects = Counter()
        for subject, raw, verdict, expiry, any_review in db.execute("""
            SELECT q.subject_id, r.content_json, v.verdict, v.expires_on,
                EXISTS(SELECT 1 FROM verification_record WHERE revision_id = r.id)
            FROM visible_question q
            JOIN current_question_revision r ON r.question_id = q.id
            LEFT JOIN verification_record v ON v.id = (
                SELECT id FROM verification_record
                WHERE revision_id = r.id AND checked_on <= ?
                ORDER BY checked_on DESC, id DESC LIMIT 1
            )
        """, (as_of,)):
            content = json.loads(raw)
            questions["top_level"] += 1
            questions["selected_revision_parts"] += len(content["parts"])
            questions["answer_fields_complete"] += complete(content, "answer")
            questions["analysis_fields_present_for_all_parts"] += complete(content, "analysis")
            status = verdict or ("scheduled" if any_review else "unreviewed")
            if status == "passed" and expiry and expiry < as_of:
                status = "expired"
            statuses[status] += 1
            subjects[subject] += 1

        papers = db.execute("""
            SELECT count(DISTINCT p.id), count(DISTINCT CASE WHEN a.id IS NOT NULL THEN p.id END),
                   count(DISTINCT CASE WHEN a.role = 'answer' THEN p.id END),
                   count(DISTINCT f.sha256)
            FROM visible_paper p
            JOIN paper_file f ON f.paper_id = p.id AND f.role = 'original'
            LEFT JOIN paper_file a ON a.paper_id = p.id AND a.role IN ('answer', 'analysis')
        """).fetchone()

        return {
            "schema": schema,
            "review_as_of": as_of,
            "physical_question_rows": count("question"),
            "revision_rows": count("question_revision"),
            "duplicate_links": count("question_duplicate"),
            "visible_current_questions": {key: questions[key] for key in (
                "top_level", "selected_revision_parts", "answer_fields_complete",
                "analysis_fields_present_for_all_parts"
            )},
            "current_review_status": dict(statuses),
            "visible_questions_by_subject_id": dict(subjects),
            "visible_knowledge_nodes": count("visible_knowledge"),
            "visible_paper_records": count("visible_paper"),
            "papers_with_original_pdf": papers[0],
            "papers_with_original_and_answer_or_analysis_file": papers[1],
            "papers_with_original_and_answer_file": papers[2],
            "distinct_original_pdf_hashes": papers[3],
            "paper_occurrences": count("question_occurrence"),
            "paper_regions": count("paper_region"),
            "fixed_composition_items": count("composition_item"),
            "verification_rows": count("verification_record"),
        }


if __name__ == "__main__":
    parser = argparse.ArgumentParser(description=__doc__)
    parser.add_argument("database", type=Path)
    parser.add_argument("--as-of", required=True, type=date.fromisoformat)
    args = parser.parse_args()
    print(json.dumps(inventory(args.database, args.as_of.isoformat()), indent=2, sort_keys=True))
