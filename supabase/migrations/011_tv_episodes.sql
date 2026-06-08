-- ─── TV episode watch history ─────────────────────────────────────────────────
-- Tracks which episodes the user has watched, with timestamps and optional
-- per-episode notes/ratings.  Replaces the current_season/current_episode
-- pointer in user_tv_entries (those columns are kept as a fast-read cache
-- and updated via application logic when a new watched episode is recorded).

CREATE TABLE IF NOT EXISTS user_tv_episodes (
  id               uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid        NOT NULL DEFAULT auth.uid()
                               REFERENCES auth.users(id) ON DELETE CASCADE,
  tv_entry_id      uuid        NOT NULL
                               REFERENCES user_tv_entries(id) ON DELETE CASCADE,
  -- Denormalized for direct queries without joining through user_tv_entries
  tv_series_id     uuid        NOT NULL
                               REFERENCES tv_series(id) ON DELETE CASCADE,
  season_number    integer     NOT NULL CHECK (season_number >= 0),
  episode_number   integer     NOT NULL CHECK (episode_number >= 0),
  -- TMDB episode ID for metadata fetch (/tv/{series}/season/{s}/episode/{e})
  tmdb_episode_id  integer,
  -- NULL = planned/not yet watched; non-NULL = watched
  watched_at       timestamptz,
  personal_note    text,
  rating           integer     CHECK (rating BETWEEN 1 AND 10),
  created_at       timestamptz DEFAULT now(),
  updated_at       timestamptz DEFAULT now(),
  UNIQUE (user_id, tv_series_id, season_number, episode_number)
);

ALTER TABLE user_tv_episodes ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies WHERE tablename = 'user_tv_episodes' AND policyname = 'user_tv_episodes_owner'
  ) THEN
    CREATE POLICY user_tv_episodes_owner ON user_tv_episodes
      FOR ALL USING (auth.uid() = user_id) WITH CHECK (auth.uid() = user_id);
  END IF;
END $$;

GRANT SELECT, INSERT, UPDATE, DELETE ON user_tv_episodes TO authenticated;

-- Fast lookup: all episodes for a given library entry, ordered by season/episode
CREATE INDEX IF NOT EXISTS user_tv_episodes_entry
  ON user_tv_episodes (tv_entry_id, season_number, episode_number);

-- Fast lookup: recently watched episodes for a user
CREATE INDEX IF NOT EXISTS user_tv_episodes_watched
  ON user_tv_episodes (user_id, watched_at DESC)
  WHERE watched_at IS NOT NULL;

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_user_tv_episodes_updated_at') THEN
    CREATE TRIGGER trg_user_tv_episodes_updated_at
      BEFORE UPDATE ON user_tv_episodes
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
