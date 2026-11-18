CREATE TABLE favorite_collection (
    id TEXT PRIMARY KEY DEFAULT (lower(hex(randomblob(16)))),
    name TEXT NOT NULL COLLATE NOCASE UNIQUE
        CHECK (name = trim(name) AND length(name) BETWEEN 1 AND 80 AND instr(name, char(0)) = 0),
    sort_order INTEGER NOT NULL DEFAULT 0,
    is_default INTEGER NOT NULL DEFAULT 0 CHECK (is_default IN (0, 1)),
    created_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    updated_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    CHECK ((id = 'default') = is_default)
) STRICT;

INSERT INTO favorite_collection(id, name, is_default) VALUES ('default', '默认收藏夹', 1);

CREATE TRIGGER favorite_default_no_delete
BEFORE DELETE ON favorite_collection WHEN OLD.is_default
BEGIN
    SELECT RAISE(ABORT, '默认收藏夹不可删除');
END;

CREATE TRIGGER favorite_default_no_replace
BEFORE INSERT ON favorite_collection
WHEN EXISTS (
    SELECT 1 FROM favorite_collection WHERE is_default AND (id = NEW.id OR name = NEW.name)
)
BEGIN
    SELECT RAISE(ABORT, '默认收藏夹不可替换');
END;

CREATE TRIGGER favorite_collection_identity
BEFORE UPDATE OF id, is_default ON favorite_collection
WHEN NEW.id <> OLD.id OR NEW.is_default <> OLD.is_default
BEGIN
    SELECT RAISE(ABORT, '收藏夹标识不可更改');
END;

CREATE TRIGGER favorite_default_name_conflict
BEFORE UPDATE OF name ON favorite_collection
WHEN NOT OLD.is_default AND EXISTS (
    SELECT 1 FROM favorite_collection WHERE is_default AND name = NEW.name
)
BEGIN
    SELECT RAISE(ABORT, '收藏夹名称已存在');
END;

CREATE TABLE favorite_target (
    id INTEGER PRIMARY KEY,
    question_id TEXT UNIQUE REFERENCES question(id) ON DELETE RESTRICT,
    paper_id TEXT UNIQUE REFERENCES paper(id) ON DELETE RESTRICT,
    knowledge_id TEXT UNIQUE REFERENCES knowledge_point(id) ON DELETE RESTRICT,
    kind TEXT GENERATED ALWAYS AS (
        CASE WHEN question_id IS NOT NULL THEN 'question'
             WHEN paper_id IS NOT NULL THEN 'paper' ELSE 'knowledge' END
    ) VIRTUAL,
    original_id TEXT GENERATED ALWAYS AS (coalesce(question_id, paper_id, knowledge_id)) VIRTUAL,
    important INTEGER NOT NULL DEFAULT 0 CHECK (important IN (0, 1)),
    CHECK ((question_id IS NOT NULL) + (paper_id IS NOT NULL) + (knowledge_id IS NOT NULL) = 1),
    UNIQUE (kind, original_id)
) STRICT;

CREATE TABLE favorite_member (
    collection_id TEXT NOT NULL REFERENCES favorite_collection(id) ON DELETE CASCADE,
    target_id INTEGER NOT NULL REFERENCES favorite_target(id) ON DELETE RESTRICT,
    added_at TEXT NOT NULL DEFAULT (strftime('%Y-%m-%dT%H:%M:%fZ', 'now')),
    PRIMARY KEY (collection_id, target_id)
) STRICT;
CREATE INDEX favorite_member_target ON favorite_member(target_id, collection_id);
CREATE INDEX favorite_collection_order ON favorite_collection(sort_order, id);
CREATE INDEX favorite_paper_original_versions ON paper_file(paper_id, imported_at DESC)
    WHERE role = 'original';

-- Keep the resource originally saved by the user. Resolve only manually confirmed identities.
CREATE VIEW favorite_identity AS
SELECT t.id, t.kind, t.original_id, coalesce(d.canonical_id, t.original_id) AS logical_id, t.important
FROM favorite_target t LEFT JOIN question_duplicate d ON d.duplicate_id = t.question_id;
