-- ─────────────────────────────────────────────────────────────────────────────
-- 050: TV watched-progress unification
--
-- Root cause of "watched episodes don't show anywhere" (verified against live
-- data 2026-07-17): THREE disjoint progress systems existed —
--   1. legacy `watched_episodes` (tv_entry_id, season, episode, watched_on):
--      209 rows incl. The Office's bulk marking of 2026-06-22 (169 rows).
--      No current code writes OR reads it.
--   2. `user_tv_episodes` (migration 011): what the current UI writes/reads.
--      211 rows — but missing what only the legacy table has (Office S9).
--   3. `user_tv_entries.current_season/current_episode`: the "fast-read cache"
--      migration 011 said would be maintained by application logic — that
--      logic was never written for the UI path, so every consumer that reads
--      these columns (Daily Watch-next, AI briefing, Ask-AI context, ai-proxy
--      get_media, MediaDetailBody chip, MediaStats) showed S1·E0 forever.
--
-- This migration: (a) backfills user_tv_episodes with everything only the
-- legacy table has, (b) drops the legacy table, (c) installs a trigger that
-- keeps the cache columns in sync with user_tv_episodes from now on, (d) does
-- a one-time recompute of the cache for all existing entries, and (e) adds
-- the missing UPDATE RLS policies on movies/tv_series so metadata upserts can
-- actually refresh stale rows (they silently failed the UPDATE branch before).
-- ─────────────────────────────────────────────────────────────────────────────

-- (a) Backfill: legacy → user_tv_episodes. tv_series_id is resolved through
-- the entry; watched_on (a date) becomes a midday timestamp so it sorts sanely
-- against real timestamps. ON CONFLICT DO NOTHING — rows the new table
-- already has (re-marked later in the UI) keep their richer values.
-- Guarded so re-running after the drop (or running against a DB that never
-- had the legacy table) is a no-op instead of an error.
DO $$ BEGIN
  IF to_regclass('public.watched_episodes') IS NOT NULL THEN
    INSERT INTO user_tv_episodes
      (user_id, tv_entry_id, tv_series_id, season_number, episode_number, watched_at)
    SELECT
      w.user_id,
      w.tv_entry_id,
      e.tv_series_id,
      w.season,
      w.episode,
      (w.watched_on::timestamp + interval '12 hours') AT TIME ZONE 'Europe/Oslo'
    FROM watched_episodes w
    JOIN user_tv_entries e ON e.id = w.tv_entry_id
    ON CONFLICT (user_id, tv_series_id, season_number, episode_number) DO NOTHING;
  END IF;
END $$;

-- (b) End the dual-source-of-truth situation for good.
DROP TABLE IF EXISTS watched_episodes;

-- (c) Cache-sync trigger: any insert/update/delete on user_tv_episodes
-- recomputes the affected entry's current_season/current_episode as the MAX
-- watched (season, episode) pair. Kept dumb and idempotent on purpose — same
-- pattern as migration 043's linked-entity triggers.
CREATE OR REPLACE FUNCTION sync_tv_entry_progress() RETURNS trigger AS $$
DECLARE
  v_entry_id uuid;
  v_season   int;
  v_episode  int;
BEGIN
  v_entry_id := COALESCE(NEW.tv_entry_id, OLD.tv_entry_id);

  SELECT season_number, episode_number
    INTO v_season, v_episode
    FROM user_tv_episodes
   WHERE tv_entry_id = v_entry_id AND watched_at IS NOT NULL
   ORDER BY season_number DESC, episode_number DESC
   LIMIT 1;

  UPDATE user_tv_entries
     SET current_season  = COALESCE(v_season, 1),
         current_episode = COALESCE(v_episode, 0),
         updated_at      = now()
   WHERE id = v_entry_id;

  RETURN COALESCE(NEW, OLD);
END;
$$ LANGUAGE plpgsql SECURITY DEFINER;

DROP TRIGGER IF EXISTS trg_sync_tv_entry_progress ON user_tv_episodes;
CREATE TRIGGER trg_sync_tv_entry_progress
  AFTER INSERT OR UPDATE OR DELETE ON user_tv_episodes
  FOR EACH ROW EXECUTE FUNCTION sync_tv_entry_progress();

-- (d) One-time recompute for every existing entry (heals The Office/The Boys
-- and anything else immediately, without waiting for the next mark).
UPDATE user_tv_entries e
   SET current_season  = COALESCE(m.max_season, 1),
       current_episode = COALESCE(m.max_episode, 0),
       updated_at      = now()
  FROM (
    SELECT tv_entry_id,
           (array_agg(season_number ORDER BY season_number DESC, episode_number DESC))[1] AS max_season,
           (array_agg(episode_number ORDER BY season_number DESC, episode_number DESC))[1] AS max_episode
      FROM user_tv_episodes
     WHERE watched_at IS NOT NULL
     GROUP BY tv_entry_id
  ) m
 WHERE e.id = m.tv_entry_id;

-- (e) movies/tv_series had SELECT+INSERT policies but no UPDATE policy, so
-- upsert(onConflict:'tmdb_id') could never refresh metadata (poster, episode
-- counts, next_episode_to_air…) once a row existed — frozen at first insert.
-- Shared catalog rows (not user-owned), so any authenticated user may update.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'movies' AND policyname = 'movies_update_auth') THEN
    CREATE POLICY movies_update_auth ON movies FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE tablename = 'tv_series' AND policyname = 'tv_series_update_auth') THEN
    CREATE POLICY tv_series_update_auth ON tv_series FOR UPDATE TO authenticated USING (true) WITH CHECK (true);
  END IF;
END $$;
