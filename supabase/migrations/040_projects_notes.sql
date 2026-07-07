-- Per-project freeform notes, shown in the new right-column sidebar on the
-- project detail page (separate from `description`, which is the short
-- blurb shown under the project title).
ALTER TABLE projects ADD COLUMN IF NOT EXISTS notes text;
