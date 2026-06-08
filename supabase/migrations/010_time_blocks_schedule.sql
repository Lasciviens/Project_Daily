-- ─── Extend time_blocks with polymorphic source linkage ───────────────────────
-- Enables any item (task, training session, movie, TV episode, project item)
-- to be scheduled to a time slot without duplicating the source data.
-- The daily timeline stays a single-table query.

ALTER TABLE time_blocks
  ADD COLUMN IF NOT EXISTS source_type text
    CHECK (source_type IN ('task', 'training_session', 'movie', 'tv_episode', 'project_item')),
  ADD COLUMN IF NOT EXISTS source_id   uuid,
  ADD COLUMN IF NOT EXISTS notes       text;

-- Only index rows that have a source link (partial index keeps it lean)
CREATE INDEX IF NOT EXISTS time_blocks_source
  ON time_blocks (source_type, source_id)
  WHERE source_id IS NOT NULL;
