CREATE TABLE backup_record (
    id TEXT PRIMARY KEY NOT NULL,
    format_version INTEGER NOT NULL CHECK (format_version > 0),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    backup_type TEXT NOT NULL CHECK (backup_type IN ('full','checkpoint')),
    schema_version INTEGER NOT NULL,
    archive_sha256 TEXT,
    file_count INTEGER NOT NULL DEFAULT 0 CHECK (file_count >= 0),
    verified INTEGER NOT NULL DEFAULT 0 CHECK (verified IN (0,1)),
    error TEXT,
    location_label TEXT NOT NULL,
    CHECK (verified = 0 OR (length(archive_sha256) = 64 AND error IS NULL))
) STRICT;

CREATE TABLE trash_item (
    id INTEGER PRIMARY KEY,
    resource_type TEXT NOT NULL CHECK (resource_type IN ('question','knowledge','paper')),
    target_id TEXT NOT NULL,
    operation_id TEXT NOT NULL UNIQUE,
    deleted_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    context_json TEXT NOT NULL CHECK (json_valid(context_json)),
    restored_at TEXT
) STRICT;
CREATE UNIQUE INDEX active_trash_target ON trash_item(resource_type,target_id) WHERE restored_at IS NULL;

CREATE TABLE edit_draft (
    id TEXT PRIMARY KEY NOT NULL,
    object_type TEXT NOT NULL CHECK (object_type IN ('question','composition')),
    object_id TEXT NOT NULL,
    base_revision INTEGER REFERENCES question_revision(id),
    format_version INTEGER NOT NULL CHECK (format_version = 1),
    payload_json TEXT NOT NULL CHECK (json_valid(payload_json)),
    sequence INTEGER NOT NULL CHECK (sequence > 0),
    edited_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    saved_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    state TEXT NOT NULL CHECK (state IN ('active','closed'))
) STRICT;
CREATE INDEX active_edit_draft ON edit_draft(saved_at) WHERE state='active';

CREATE TABLE draft_attachment (
    draft_id TEXT NOT NULL REFERENCES edit_draft(id),
    attachment_id TEXT NOT NULL REFERENCES attachment(attachment_id),
    PRIMARY KEY(draft_id,attachment_id)
) STRICT;

CREATE VIEW visible_question AS
SELECT q.* FROM logical_question q WHERE NOT EXISTS(
    SELECT 1 FROM trash_item t WHERE t.resource_type='question' AND t.target_id=q.id AND t.restored_at IS NULL
);

CREATE VIEW visible_knowledge AS
SELECT k.* FROM effective_knowledge_point k WHERE NOT EXISTS(
    SELECT 1 FROM trash_item t WHERE t.resource_type='knowledge' AND t.target_id=k.id AND t.restored_at IS NULL
);

CREATE VIEW visible_paper AS
SELECT p.* FROM effective_paper p WHERE NOT EXISTS(
    SELECT 1 FROM trash_item t WHERE t.resource_type='paper' AND t.target_id=p.id AND t.restored_at IS NULL
);
