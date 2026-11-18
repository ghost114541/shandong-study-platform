
-- Existing catalog papers keep their identity, even if they have no PDF.
ALTER TABLE paper ADD COLUMN subject_id TEXT REFERENCES subject(id);

CREATE UNIQUE INDEX occurrence_identity ON question_occurrence(paper_id, source_key, question_id);

CREATE TABLE paper_file (
    id TEXT PRIMARY KEY,
    paper_id TEXT NOT NULL REFERENCES paper(id),
    role TEXT NOT NULL CHECK (role IN ('original', 'answer', 'analysis')),
    sha256 TEXT NOT NULL CHECK (length(sha256) = 64 AND sha256 NOT GLOB '*[^0-9a-f]*'),
    byte_size INTEGER NOT NULL CHECK (byte_size BETWEEN 1 AND 67108864),
    page_count INTEGER NOT NULL CHECK (page_count BETWEEN 1 AND 500),
    original_name TEXT NOT NULL,
    source TEXT,
    imported_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE (paper_id, role, sha256),
    UNIQUE (id, paper_id)
) STRICT;

CREATE TRIGGER paper_file_no_update BEFORE UPDATE ON paper_file
BEGIN
    SELECT RAISE(ABORT, 'immutable PDF version');
END;

CREATE TABLE paper_region (
    paper_id TEXT NOT NULL,
    source_key TEXT NOT NULL,
    question_id TEXT NOT NULL,
    file_id TEXT NOT NULL,
    ordinal INTEGER NOT NULL CHECK (ordinal BETWEEN 0 AND 63),
    page_index INTEGER NOT NULL CHECK (page_index BETWEEN 0 AND 499),
    x0 REAL NOT NULL,
    y0 REAL NOT NULL,
    x1 REAL NOT NULL,
    y1 REAL NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (paper_id, source_key, file_id, ordinal),
    FOREIGN KEY (paper_id, source_key, question_id)
        REFERENCES question_occurrence(paper_id, source_key, question_id),
    FOREIGN KEY (file_id, paper_id) REFERENCES paper_file(id, paper_id),
    CHECK (0 <= x0 AND x0 < x1 AND x1 <= 1 AND 0 <= y0 AND y0 < y1 AND y1 <= 1)
) STRICT;

CREATE INDEX paper_region_file_page ON paper_region(file_id, page_index);
CREATE INDEX paper_region_question ON paper_region(question_id);

CREATE TRIGGER paper_region_validate BEFORE INSERT ON paper_region
WHEN NOT EXISTS (
    SELECT 1 FROM paper_file
    WHERE id = NEW.file_id AND paper_id = NEW.paper_id AND role = 'original' AND NEW.page_index < page_count
)
BEGIN
    SELECT RAISE(ABORT, 'invalid original PDF page or version');
END;

CREATE TRIGGER paper_region_no_update BEFORE UPDATE ON paper_region
BEGIN
    SELECT RAISE(ABORT, 'replace regions as a set');
END;
