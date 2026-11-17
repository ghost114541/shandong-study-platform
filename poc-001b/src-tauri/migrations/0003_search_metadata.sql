CREATE VIEW question_identity AS
SELECT q.id AS original_id, coalesce(d.canonical_id, q.id) AS logical_id, q.subject_id
FROM question q LEFT JOIN question_duplicate d ON d.duplicate_id = q.id;

CREATE VIEW logical_question AS
SELECT original_id AS id, subject_id FROM question_identity WHERE original_id = logical_id;

CREATE VIEW logical_question_knowledge AS
SELECT i.logical_id, link.question_id AS original_id, link.knowledge_id
FROM question_knowledge link JOIN question_identity i ON i.original_id = link.question_id;

-- Index-friendly lookup of all original identities for a known logical question.
CREATE VIEW question_members AS
SELECT id AS logical_id, id AS original_id FROM logical_question
UNION ALL SELECT canonical_id, duplicate_id FROM question_duplicate;

CREATE TABLE question_annotation (
    question_id TEXT PRIMARY KEY REFERENCES question(id),
    difficulty INTEGER CHECK (difficulty BETWEEN 1 AND 5)
) STRICT;
CREATE TABLE question_tag (
    question_id TEXT NOT NULL REFERENCES question(id),
    tag TEXT NOT NULL CHECK (length(trim(tag)) BETWEEN 1 AND 120),
    PRIMARY KEY (question_id, tag)
) STRICT;
CREATE INDEX question_tag_tag ON question_tag(tag, question_id);

-- Local paper overlay. Does not grant any license or change the original paper.
CREATE TABLE paper_user_metadata (
    paper_id TEXT PRIMARY KEY REFERENCES paper(id),
    year INTEGER CHECK (year BETWEEN 1 AND 9999),
    region TEXT CHECK (length(trim(region)) BETWEEN 1 AND 120),
    source TEXT CHECK (length(trim(source)) BETWEEN 1 AND 120)
) STRICT;

ALTER TABLE revision_search_text ADD COLUMN question_type TEXT;
UPDATE revision_search_text SET question_type = (
    SELECT CASE WHEN json_type(content_json, '$.question_type') = 'text'
           THEN json_extract(content_json, '$.question_type') END
    FROM question_revision WHERE id = revision_id
);
DROP TRIGGER question_revision_search_insert;
CREATE TRIGGER question_revision_search_insert
AFTER INSERT ON question_revision
BEGIN
    INSERT INTO revision_search_text(revision_id, text, question_type)
    SELECT id, text, CASE WHEN json_type(NEW.content_json, '$.question_type') = 'text'
                   THEN json_extract(NEW.content_json, '$.question_type') END
    FROM revision_search_source WHERE id = NEW.id;
END;
