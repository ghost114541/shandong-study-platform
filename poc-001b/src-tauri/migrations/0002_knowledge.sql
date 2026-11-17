INSERT OR IGNORE INTO subject(id, name) VALUES
    ('chinese', '语文'), ('math', '数学'), ('english', '英语'),
    ('physics', '物理'), ('chemistry', '化学'), ('biology', '生物'),
    ('politics', '思想政治'), ('history', '历史'), ('geography', '地理');

ALTER TABLE knowledge_point ADD COLUMN origin TEXT NOT NULL DEFAULT 'user'
    CHECK (origin IN ('standard', 'user'));
ALTER TABLE knowledge_point ADD COLUMN sort_order INTEGER NOT NULL DEFAULT 0;
ALTER TABLE knowledge_point ADD COLUMN enabled INTEGER NOT NULL DEFAULT 1 CHECK (enabled IN (0, 1));

-- Every existing node must be reachable from a root. A failed check rolls back
-- rather than silently dropping or relocating an invalid legacy subtree.
CREATE TEMP TABLE knowledge_hierarchy_check(missing INTEGER CHECK (missing = 0));
WITH RECURSIVE rooted(id, subject_id) AS (
    SELECT id, subject_id FROM knowledge_point WHERE parent_id IS NULL
    UNION ALL
    SELECT k.id, k.subject_id FROM knowledge_point k
    JOIN rooted r ON k.subject_id = r.subject_id AND k.parent_id = r.id
)
INSERT INTO knowledge_hierarchy_check
SELECT (SELECT count(*) FROM knowledge_point) - (SELECT count(*) FROM rooted);
DROP TABLE knowledge_hierarchy_check;

CREATE TRIGGER knowledge_point_protect_update
BEFORE UPDATE ON knowledge_point
WHEN OLD.origin = 'standard' OR NEW.origin <> OLD.origin OR NEW.id <> OLD.id OR NEW.subject_id <> OLD.subject_id
BEGIN
    SELECT RAISE(ABORT, 'cannot replace knowledge identity or edit a standard point');
END;

CREATE TRIGGER knowledge_point_protect_delete
BEFORE DELETE ON knowledge_point WHEN OLD.origin = 'standard'
BEGIN
    SELECT RAISE(ABORT, 'cannot delete standard knowledge');
END;

CREATE TRIGGER knowledge_point_protect_replace
BEFORE INSERT ON knowledge_point WHEN EXISTS (SELECT 1 FROM knowledge_point WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'cannot replace a knowledge point');
END;

CREATE TRIGGER knowledge_point_insert_cycle
AFTER INSERT ON knowledge_point WHEN NEW.parent_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'knowledge cycle') WHERE NEW.id IN (
        WITH RECURSIVE ancestors(id) AS (
            SELECT NEW.parent_id
            UNION
            SELECT k.parent_id FROM knowledge_point k JOIN ancestors a ON k.id = a.id
            WHERE k.parent_id IS NOT NULL
        )
        SELECT id FROM ancestors
    );
END;

CREATE TRIGGER knowledge_point_update_cycle
AFTER UPDATE OF parent_id ON knowledge_point WHEN NEW.parent_id IS NOT NULL
BEGIN
    SELECT RAISE(ABORT, 'knowledge cycle') WHERE NEW.id IN (
        WITH RECURSIVE ancestors(id) AS (
            SELECT NEW.parent_id
            UNION
            SELECT k.parent_id FROM knowledge_point k JOIN ancestors a ON k.id = a.id
            WHERE k.parent_id IS NOT NULL
        )
        SELECT id FROM ancestors
    );
END;

CREATE TABLE knowledge_alias (
    knowledge_id TEXT NOT NULL REFERENCES knowledge_point(id),
    alias TEXT NOT NULL CHECK (length(trim(alias)) BETWEEN 1 AND 120),
    PRIMARY KEY (knowledge_id, alias)
) STRICT;

CREATE UNIQUE INDEX question_subject_identity ON question(subject_id, id);
CREATE TABLE question_knowledge (
    question_id TEXT NOT NULL,
    knowledge_id TEXT NOT NULL,
    subject_id TEXT NOT NULL,
    PRIMARY KEY (question_id, knowledge_id),
    FOREIGN KEY (subject_id, question_id) REFERENCES question(subject_id, id),
    FOREIGN KEY (subject_id, knowledge_id) REFERENCES knowledge_point(subject_id, id)
) STRICT;
CREATE INDEX question_knowledge_reverse ON question_knowledge(knowledge_id, question_id);

INSERT INTO knowledge_point(id, subject_id, title, origin)
    SELECT 'dev003-demo-functions', id, '演示 · 函数', 'standard'
    FROM subject WHERE id = 'math' AND name = '数学';
INSERT INTO knowledge_point(id, subject_id, parent_id, title, origin)
    SELECT 'dev003-demo-quadratic', subject_id, id, '演示 · 二次函数', 'standard'
    FROM knowledge_point WHERE id = 'dev003-demo-functions';

-- Omit image sources, answers, analyses and attachment metadata.
CREATE VIEW revision_search_source AS
SELECT r.id, coalesce((
    SELECT group_concat(paragraph, char(10)) FROM (
        SELECT (SELECT group_concat(text, '') FROM (
            SELECT CASE WHEN node.value ->> '$.type' = 'text' THEN node.value ->> '$.text' ELSE char(10) END AS text
            FROM json_each(block.value, '$.content') node ORDER BY node.key
        )) AS paragraph, -1 AS part_order, block.key AS block_order
        FROM json_each(r.content_json, '$.stem.content') block
        WHERE block.value ->> '$.type' = 'paragraph'
        UNION ALL
        SELECT (SELECT group_concat(text, '') FROM (
            SELECT CASE WHEN node.value ->> '$.type' = 'text' THEN node.value ->> '$.text' ELSE char(10) END AS text
            FROM json_each(block.value, '$.content') node ORDER BY node.key
        )), part.key, block.key
        FROM json_each(r.content_json, '$.parts') part,
             json_each(part.value, '$.prompt.content') block
        WHERE block.value ->> '$.type' = 'paragraph'
        ORDER BY part_order, block_order
    )
), '') AS text
FROM question_revision r;

CREATE TABLE revision_search_text (
    revision_id INTEGER PRIMARY KEY REFERENCES question_revision(id),
    text TEXT NOT NULL
) STRICT;
INSERT INTO revision_search_text(revision_id, text) SELECT id, text FROM revision_search_source;
CREATE TRIGGER question_revision_search_insert
AFTER INSERT ON question_revision
BEGIN
    INSERT INTO revision_search_text(revision_id, text)
    SELECT id, text FROM revision_search_source WHERE id = NEW.id;
END;

-- Expose the existing question/revision equality to the query planner.
DROP VIEW current_question_revision;
CREATE VIEW current_question_revision AS
SELECT revision.*
FROM question AS q
JOIN question_revision AS revision ON revision.question_id = q.id AND revision.id = coalesce(
    (SELECT id FROM question_revision WHERE question_id = q.id AND scope = 'user' ORDER BY id DESC LIMIT 1),
    (SELECT id FROM question_revision WHERE question_id = q.id AND scope = 'public' ORDER BY id DESC LIMIT 1)
);
