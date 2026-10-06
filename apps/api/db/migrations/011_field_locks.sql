-- 011: field locks — like bucket_locked, a title/type/tags the user set by hand
-- survives re-enrichment (text edits, "Regenerate summary", the background save step).

ALTER TABLE notes ADD COLUMN IF NOT EXISTS title_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS type_locked BOOLEAN NOT NULL DEFAULT false;
ALTER TABLE notes ADD COLUMN IF NOT EXISTS tags_locked BOOLEAN NOT NULL DEFAULT false;
