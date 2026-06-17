-- RP5 Database migration — run in the RP5 Supabase SQL Editor (NOT the main project)
-- Adds play_order column to games table for the Play Queue feature

ALTER TABLE games ADD COLUMN IF NOT EXISTS play_order integer DEFAULT NULL;

-- Optional: index for faster queue ordering
CREATE INDEX IF NOT EXISTS idx_games_play_order ON games (play_order ASC NULLS LAST);

-- RLS: if your games table has RLS enabled, make sure updates are allowed.
-- If the anon key should be able to update, add a policy like:
-- CREATE POLICY "allow_update" ON games FOR UPDATE USING (true);
-- Or authenticate the RP5 client with the same user as your main project.
