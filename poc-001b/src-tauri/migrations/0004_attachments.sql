CREATE TABLE attachment (
    attachment_id TEXT PRIMARY KEY,
    sha256 TEXT NOT NULL UNIQUE CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    media_type TEXT NOT NULL CHECK (media_type IN ('image/png', 'image/jpeg', 'image/webp', 'image/gif')),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 5242880),
    storage_key TEXT NOT NULL UNIQUE CHECK (storage_key = substr(sha256, 1, 2) || '/' || sha256),
    registered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    CHECK (attachment_id = 'sha256-' || sha256)
) STRICT;

CREATE TABLE revision_attachment (
    revision_id INTEGER NOT NULL REFERENCES question_revision(id) ON DELETE RESTRICT,
    attachment_id TEXT NOT NULL REFERENCES attachment(attachment_id) ON DELETE RESTRICT,
    PRIMARY KEY (revision_id, attachment_id)
) STRICT;

CREATE INDEX attachment_revisions ON revision_attachment(attachment_id, revision_id);
