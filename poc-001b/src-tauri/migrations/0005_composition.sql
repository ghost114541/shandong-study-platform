ALTER TABLE composition ADD COLUMN settings_json TEXT CHECK (settings_json IS NULL OR json_valid(settings_json));
ALTER TABLE composition ADD COLUMN previous_id TEXT REFERENCES composition(id) ON DELETE RESTRICT;
ALTER TABLE composition ADD COLUMN item_count INTEGER CHECK (item_count IS NULL OR item_count > 0);
ALTER TABLE composition_item ADD COLUMN settings_json TEXT CHECK (settings_json IS NULL OR json_valid(settings_json));

CREATE INDEX composition_previous ON composition(previous_id);

CREATE TRIGGER composition_no_update
BEFORE UPDATE ON composition
BEGIN
    SELECT RAISE(ABORT, 'saved composition is immutable');
END;

CREATE TRIGGER composition_no_replace
BEFORE INSERT ON composition
WHEN EXISTS (SELECT 1 FROM composition WHERE id = NEW.id)
BEGIN
    SELECT RAISE(ABORT, 'saved composition cannot be replaced');
END;

CREATE TRIGGER composition_configured_item
BEFORE INSERT ON composition_item
WHEN EXISTS (
    SELECT 1 FROM composition
    WHERE id = NEW.composition_id AND item_count IS NOT NULL
      AND (NEW.position > item_count OR NEW.settings_json IS NULL)
)
BEGIN
    SELECT RAISE(ABORT, 'configured composition has a fixed item range');
END;
