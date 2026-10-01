-- 121 — IGDB (igdb.com, Twitch's game database): game length, ratings and a
-- link to the game's page, for every library (retro, Steam, PlayStation).
--
-- Its own source, deliberately separate from ScreenScraper (migration 104):
-- its own match marker (igdb_id), its own columns, and nothing here overwrites
-- a title, cover, description or any field another source or the owner set.
-- Written only by the igdb-api edge function (service role, scoped to the
-- caller). Updates no existing row.
--
-- Columns are promoted where the library lists, sorts or counts on them
-- (lengths, ratings); the rest of what IGDB says about a game (themes, modes,
-- perspectives, franchises, engines, studios, similar games, cover id) is one
-- small jsonb, read by the game detail. Ratings are IGDB's own 0–100 scale.

ALTER TABLE games
  ADD COLUMN IF NOT EXISTS igdb_id              integer,
  ADD COLUMN IF NOT EXISTS igdb_slug            text,
  ADD COLUMN IF NOT EXISTS igdb_url             text,
  -- How the match was made: 'steam' (Steam app id), 'exact' (title + platform),
  -- 'picked' (the owner chose it from the results).
  ADD COLUMN IF NOT EXISTS igdb_match           text CHECK (igdb_match IN ('steam', 'exact', 'picked')),
  ADD COLUMN IF NOT EXISTS igdb_matched_at      timestamptz,
  ADD COLUMN IF NOT EXISTS igdb_fetched_at      timestamptz,
  -- IGDB members' average, critics' average, and both together.
  ADD COLUMN IF NOT EXISTS igdb_rating          real,
  ADD COLUMN IF NOT EXISTS igdb_rating_count    integer,
  ADD COLUMN IF NOT EXISTS igdb_critic_rating   real,
  ADD COLUMN IF NOT EXISTS igdb_critic_count    integer,
  ADD COLUMN IF NOT EXISTS igdb_total_rating    real,
  ADD COLUMN IF NOT EXISTS igdb_total_count     integer,
  -- Time to beat, in seconds (IGDB's game_time_to_beats): to the credits,
  -- with some extras, and to 100 %. Submitted by IGDB members.
  ADD COLUMN IF NOT EXISTS ttb_main_seconds     integer,
  ADD COLUMN IF NOT EXISTS ttb_extra_seconds    integer,
  ADD COLUMN IF NOT EXISTS ttb_full_seconds     integer,
  ADD COLUMN IF NOT EXISTS ttb_count            integer,
  ADD COLUMN IF NOT EXISTS igdb_data            jsonb;

-- One IGDB game may be matched to several rows (a retro and a Steam copy),
-- so this is an index, not a unique key.
CREATE INDEX IF NOT EXISTS games_igdb_id_idx ON games (user_id, igdb_id) WHERE igdb_id IS NOT NULL;
