CREATE TABLE subject (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    name TEXT NOT NULL UNIQUE CHECK (length(trim(name)) > 0)
) STRICT;

CREATE TABLE knowledge_point (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    subject_id TEXT NOT NULL REFERENCES subject(id),
    parent_id TEXT CHECK (parent_id <> id),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    UNIQUE (subject_id, id),
    FOREIGN KEY (subject_id, parent_id) REFERENCES knowledge_point(subject_id, id)
) STRICT;
CREATE INDEX knowledge_point_parent ON knowledge_point(subject_id, parent_id);

CREATE TABLE question (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    subject_id TEXT NOT NULL REFERENCES subject(id)
) STRICT;
CREATE INDEX question_subject ON question(subject_id);

CREATE TABLE question_part (
    question_id TEXT NOT NULL REFERENCES question(id),
    id TEXT NOT NULL CHECK (length(trim(id)) > 0),
    PRIMARY KEY (question_id, id)
) STRICT;

CREATE TABLE paper (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0)
) STRICT;

CREATE TABLE question_occurrence (
    paper_id TEXT NOT NULL REFERENCES paper(id),
    source_key TEXT NOT NULL CHECK (length(trim(source_key)) > 0),
    question_id TEXT NOT NULL REFERENCES question(id),
    PRIMARY KEY (paper_id, source_key)
) STRICT;
CREATE INDEX question_occurrence_question ON question_occurrence(question_id);

CREATE TABLE question_duplicate (
    duplicate_id TEXT PRIMARY KEY REFERENCES question(id),
    canonical_id TEXT NOT NULL REFERENCES question(id),
    reviewer TEXT NOT NULL CHECK (length(trim(reviewer, char(9, 10, 11, 12, 13, 32))) > 0),
    confirmed_on TEXT NOT NULL CHECK (date(confirmed_on, '+0 days') IS confirmed_on),
    evidence TEXT NOT NULL CHECK (length(trim(evidence, char(9, 10, 11, 12, 13, 32))) > 0),
    CHECK (duplicate_id <> canonical_id)
) STRICT;
CREATE INDEX question_duplicate_canonical ON question_duplicate(canonical_id);

CREATE TRIGGER question_duplicate_no_chain
BEFORE INSERT ON question_duplicate
WHEN EXISTS (SELECT 1 FROM question_duplicate WHERE duplicate_id = NEW.duplicate_id)
     OR EXISTS (SELECT 1 FROM question_duplicate
             WHERE duplicate_id = NEW.canonical_id OR canonical_id = NEW.duplicate_id)
     OR (SELECT subject_id FROM question WHERE id = NEW.duplicate_id)
       <> (SELECT subject_id FROM question WHERE id = NEW.canonical_id)
BEGIN
    SELECT RAISE(ABORT, 'duplicate requires a canonical question in the same subject and no chain');
END;

CREATE TRIGGER question_duplicate_no_update
BEFORE UPDATE ON question_duplicate
BEGIN
    SELECT RAISE(ABORT, 'duplicate confirmation cannot be rewritten');
END;

CREATE TABLE question_revision (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    question_id TEXT NOT NULL REFERENCES question(id),
    base_revision_id INTEGER,
    scope TEXT NOT NULL CHECK (scope IN ('public', 'user')),
    content_version INTEGER NOT NULL CHECK (content_version > 0),
    content_json TEXT NOT NULL CHECK (
        json_valid(content_json)
        AND json_type(content_json, '$.schema_version') IS 'integer'
        AND json_extract(content_json, '$.schema_version') = content_version
        AND json_type(content_json, '$.stem') IS 'object'
        AND json_type(content_json, '$.parts') IS 'array'
    ),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (question_id, id),
    FOREIGN KEY (question_id, base_revision_id) REFERENCES question_revision(question_id, id)
) STRICT;
CREATE INDEX question_revision_selection ON question_revision(question_id, scope, id);
CREATE INDEX question_revision_base ON question_revision(question_id, base_revision_id);

CREATE TRIGGER question_revision_validate_insert
BEFORE INSERT ON question_revision
WHEN EXISTS (SELECT 1 FROM question_revision WHERE id = NEW.id)
     OR (NEW.base_revision_id IS NOT NULL AND NOT EXISTS (
         SELECT 1 FROM question_revision
         WHERE id = NEW.base_revision_id AND question_id = NEW.question_id
           AND (NEW.scope = 'user' OR scope = 'public')
     ))
     OR EXISTS (
         SELECT 1 FROM json_each(NEW.content_json, '$.parts') AS part
         WHERE NOT EXISTS (
             SELECT 1 FROM question_part AS registered
             WHERE registered.question_id = NEW.question_id
               AND registered.id = json_extract(part.value, '$.id')
         )
     )
BEGIN
    SELECT RAISE(ABORT, 'invalid revision ancestry, part id or replacement');
END;

CREATE TRIGGER question_revision_no_update
BEFORE UPDATE ON question_revision
BEGIN
    SELECT RAISE(ABORT, 'question revision is immutable');
END;

CREATE TRIGGER question_revision_no_delete
BEFORE DELETE ON question_revision
BEGIN
    SELECT RAISE(ABORT, 'question revision is immutable');
END;

CREATE VIEW current_question_revision AS
SELECT revision.*
FROM question AS q
JOIN question_revision AS revision ON revision.id = coalesce(
    (SELECT id FROM question_revision WHERE question_id = q.id AND scope = 'user' ORDER BY id DESC LIMIT 1),
    (SELECT id FROM question_revision WHERE question_id = q.id AND scope = 'public' ORDER BY id DESC LIMIT 1)
);

CREATE TABLE verification_record (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    revision_id INTEGER NOT NULL REFERENCES question_revision(id),
    reviewer TEXT NOT NULL CHECK (length(trim(reviewer, char(9, 10, 11, 12, 13, 32))) > 0),
    checked_on TEXT NOT NULL CHECK (date(checked_on, '+0 days') IS checked_on),
    evidence TEXT NOT NULL CHECK (length(trim(evidence, char(9, 10, 11, 12, 13, 32))) > 0),
    verdict TEXT NOT NULL CHECK (verdict IN ('passed', 'disputed', 'failed')),
    expires_on TEXT CHECK (
        expires_on IS NULL OR (date(expires_on, '+0 days') IS expires_on AND expires_on >= checked_on)
    ),
    review_of INTEGER,
    UNIQUE (revision_id, id),
    FOREIGN KEY (revision_id, review_of) REFERENCES verification_record(revision_id, id)
) STRICT;
CREATE INDEX verification_record_date ON verification_record(revision_id, checked_on DESC, id DESC);

CREATE TRIGGER verification_record_validate_insert
BEFORE INSERT ON verification_record
WHEN EXISTS (SELECT 1 FROM verification_record WHERE id = NEW.id)
     OR NEW.review_of IS NOT (
         SELECT id FROM verification_record WHERE revision_id = NEW.revision_id ORDER BY id DESC LIMIT 1
     )
     OR NEW.checked_on < (SELECT checked_on FROM verification_record WHERE id = NEW.review_of)
BEGIN
    SELECT RAISE(ABORT, 'review must append to the latest record for the same revision');
END;

CREATE TRIGGER verification_record_no_update
BEFORE UPDATE ON verification_record
BEGIN
    SELECT RAISE(ABORT, 'verification record is append-only');
END;

CREATE TRIGGER verification_record_no_delete
BEFORE DELETE ON verification_record
BEGIN
    SELECT RAISE(ABORT, 'verification record is append-only');
END;

CREATE TABLE composition (
    id TEXT PRIMARY KEY CHECK (length(trim(id)) > 0),
    title TEXT NOT NULL CHECK (length(trim(title)) > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
) STRICT;

CREATE TABLE composition_item (
    composition_id TEXT NOT NULL REFERENCES composition(id) ON DELETE CASCADE,
    position INTEGER NOT NULL CHECK (position > 0),
    question_id TEXT NOT NULL,
    revision_id INTEGER NOT NULL,
    PRIMARY KEY (composition_id, position),
    FOREIGN KEY (question_id, revision_id) REFERENCES question_revision(question_id, id) ON DELETE RESTRICT
) STRICT;
CREATE INDEX composition_item_revision ON composition_item(question_id, revision_id);

CREATE TRIGGER composition_item_no_update
BEFORE UPDATE ON composition_item
BEGIN
    SELECT RAISE(ABORT, 'saved composition pins a revision');
END;


CREATE TRIGGER composition_item_no_replace
BEFORE INSERT ON composition_item
WHEN EXISTS (SELECT 1 FROM composition_item
             WHERE composition_id = NEW.composition_id AND position = NEW.position)
BEGIN
    SELECT RAISE(ABORT, 'saved composition pins a revision');
END;

CREATE TRIGGER composition_item_no_partial_delete
BEFORE DELETE ON composition_item
WHEN EXISTS (SELECT 1 FROM composition WHERE id = OLD.composition_id)
BEGIN
    SELECT RAISE(ABORT, 'saved composition item cannot be removed separately');
END;

CREATE TRIGGER question_part_no_update
BEFORE UPDATE ON question_part
BEGIN
    SELECT RAISE(ABORT, 'question part identity is immutable');
END;

CREATE TRIGGER question_part_no_delete
BEFORE DELETE ON question_part
BEGIN
    SELECT RAISE(ABORT, 'question part identity is immutable');
END;
