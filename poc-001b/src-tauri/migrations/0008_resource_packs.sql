
CREATE TABLE pack_identity (
    id TEXT PRIMARY KEY
) STRICT;

CREATE TABLE pack_operation (
    id TEXT PRIMARY KEY,
    pack_id TEXT NOT NULL,
    version TEXT NOT NULL,
    archive_sha TEXT NOT NULL,
    state TEXT NOT NULL CHECK (state IN ('validated','staged','committing','installed','failed','interrupted')),
    started_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    finished_at TEXT,
    error TEXT,
    pending_cleanup INTEGER NOT NULL DEFAULT 1 CHECK (pending_cleanup IN (0,1))
) STRICT;
CREATE INDEX pack_operation_cleanup ON pack_operation(pending_cleanup, state, id);

CREATE TABLE pack_version (
    id INTEGER PRIMARY KEY,
    pack_id TEXT NOT NULL REFERENCES pack_identity(id),
    version TEXT NOT NULL,
    operation_id TEXT NOT NULL UNIQUE REFERENCES pack_operation(id),
    manifest_sha TEXT NOT NULL,
    archive_sha TEXT NOT NULL,
    manifest_json TEXT NOT NULL CHECK(json_valid(manifest_json)),
    rights_json TEXT NOT NULL CHECK(json_valid(rights_json)),
    unpacked_bytes INTEGER NOT NULL,
    installed_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    integrity_error TEXT,
    UNIQUE(pack_id, version)
) STRICT;

CREATE TABLE pack_file (
    version_id INTEGER NOT NULL REFERENCES pack_version(id),
    path TEXT NOT NULL,
    sha256 TEXT NOT NULL,
    byte_size INTEGER NOT NULL,
    role TEXT NOT NULL,
    PRIMARY KEY(version_id, path)
) STRICT;
CREATE INDEX pack_file_blob ON pack_file(role, sha256);

CREATE TABLE pack_operation_blob (
    operation_id TEXT NOT NULL REFERENCES pack_operation(id),
    sha256 TEXT NOT NULL,
    folder TEXT NOT NULL CHECK(folder IN ('attachments','paper-pdfs')),
    byte_size INTEGER NOT NULL,
    PRIMARY KEY(operation_id, sha256)
) STRICT;

CREATE TABLE pack_knowledge_owner (
    knowledge_id TEXT PRIMARY KEY REFERENCES knowledge_point(id),
    pack_id TEXT NOT NULL REFERENCES pack_identity(id)
) STRICT;
CREATE TABLE pack_question_owner (
    question_id TEXT PRIMARY KEY REFERENCES question(id),
    pack_id TEXT NOT NULL REFERENCES pack_identity(id)
) STRICT;
CREATE TABLE pack_paper_owner (
    paper_id TEXT PRIMARY KEY REFERENCES paper(id),
    pack_id TEXT NOT NULL REFERENCES pack_identity(id)
) STRICT;

CREATE TABLE pack_knowledge_version (
    knowledge_id TEXT NOT NULL REFERENCES pack_knowledge_owner(knowledge_id),
    version_id INTEGER NOT NULL REFERENCES pack_version(id),
    title TEXT NOT NULL,
    sort_order INTEGER NOT NULL,
    aliases_json TEXT NOT NULL CHECK(json_valid(aliases_json)),
    rights_id TEXT NOT NULL,
    PRIMARY KEY(knowledge_id, version_id)
) STRICT;

CREATE VIEW effective_knowledge_point AS
SELECT k.id, k.subject_id, k.parent_id, coalesce(v.title,k.title) AS title,
       coalesce(v.sort_order,k.sort_order) AS sort_order, k.origin, k.enabled
FROM knowledge_point k LEFT JOIN pack_knowledge_version v ON v.knowledge_id=k.id AND v.version_id=(
    SELECT max(version_id) FROM pack_knowledge_version WHERE knowledge_id=k.id
);

CREATE VIEW effective_knowledge_alias AS
SELECT knowledge_id, alias FROM knowledge_alias
UNION
SELECT v.knowledge_id, a.value
FROM pack_knowledge_version v, json_each(v.aliases_json) a
WHERE v.version_id=(SELECT max(version_id) FROM pack_knowledge_version WHERE knowledge_id=v.knowledge_id);

CREATE TABLE pack_question_version (
    question_id TEXT NOT NULL REFERENCES pack_question_owner(question_id),
    version_id INTEGER NOT NULL REFERENCES pack_version(id),
    revision_key TEXT NOT NULL,
    revision_id INTEGER NOT NULL REFERENCES question_revision(id),
    rights_id TEXT NOT NULL,
    PRIMARY KEY(question_id, version_id)
) STRICT;
CREATE INDEX pack_question_revision_key ON pack_question_version(question_id, revision_key);

CREATE TABLE pack_question_knowledge (
    question_id TEXT NOT NULL,
    version_id INTEGER NOT NULL,
    knowledge_id TEXT NOT NULL REFERENCES knowledge_point(id),
    PRIMARY KEY(question_id, version_id, knowledge_id),
    FOREIGN KEY(question_id, version_id) REFERENCES pack_question_version(question_id, version_id)
) STRICT;
CREATE INDEX pack_question_knowledge_reverse ON pack_question_knowledge(knowledge_id, question_id, version_id);

CREATE TABLE pack_knowledge_hidden (
    question_id TEXT NOT NULL REFERENCES pack_question_owner(question_id),
    knowledge_id TEXT NOT NULL REFERENCES knowledge_point(id),
    PRIMARY KEY(question_id, knowledge_id)
) STRICT;

CREATE VIEW effective_question_knowledge AS
SELECT question_id, knowledge_id FROM question_knowledge
UNION ALL
SELECT k.question_id, k.knowledge_id FROM pack_question_knowledge k
WHERE k.version_id=(SELECT max(version_id) FROM pack_question_version WHERE question_id=k.question_id)
  AND NOT EXISTS (SELECT 1 FROM pack_knowledge_hidden h WHERE h.question_id=k.question_id AND h.knowledge_id=k.knowledge_id)
  AND NOT EXISTS (SELECT 1 FROM question_knowledge u WHERE u.question_id=k.question_id AND u.knowledge_id=k.knowledge_id);

DROP VIEW logical_question_knowledge;
CREATE VIEW logical_question_knowledge AS
SELECT i.logical_id, link.question_id AS original_id, link.knowledge_id
FROM effective_question_knowledge link JOIN question_identity i ON i.original_id=link.question_id;

CREATE TABLE pack_paper_version (
    paper_id TEXT NOT NULL REFERENCES pack_paper_owner(paper_id),
    version_id INTEGER NOT NULL REFERENCES pack_version(id),
    title TEXT NOT NULL,
    year INTEGER,
    region TEXT,
    source TEXT,
    rights_id TEXT NOT NULL,
    record_sha TEXT NOT NULL,
    PRIMARY KEY(paper_id, version_id)
) STRICT;

CREATE VIEW effective_paper AS
SELECT p.id, coalesce(v.title,p.title) AS title, p.subject_id,
       CASE WHEN u.paper_id IS NOT NULL THEN u.year ELSE v.year END AS year,
       CASE WHEN u.paper_id IS NOT NULL THEN u.region ELSE v.region END AS region,
       CASE WHEN u.paper_id IS NOT NULL THEN u.source ELSE v.source END AS source
FROM paper p LEFT JOIN paper_user_metadata u ON u.paper_id=p.id
LEFT JOIN pack_paper_version v ON v.paper_id=p.id AND v.version_id=(
    SELECT max(version_id) FROM pack_paper_version WHERE paper_id=p.id
);

CREATE TABLE pack_paper_file (
    version_id INTEGER NOT NULL REFERENCES pack_version(id),
    file_id TEXT NOT NULL REFERENCES paper_file(id),
    rights_id TEXT NOT NULL,
    PRIMARY KEY(version_id, file_id)
) STRICT;

CREATE TABLE pack_paper_occurrence (
    version_id INTEGER NOT NULL REFERENCES pack_version(id),
    paper_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    question_id TEXT NOT NULL,
    PRIMARY KEY(version_id, paper_id, source_key),
    FOREIGN KEY(paper_id, source_key, question_id) REFERENCES question_occurrence(paper_id, source_key, question_id)
) STRICT;
