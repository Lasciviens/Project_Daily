-- ============================================================
-- 092 — steam_apps (shared Steam store-metadata cache)
-- ============================================================
-- The Games page's Steam tab shows a library fetched live from Steam's Web
-- API (`steam-api` edge function, no local table — see migration 091's
-- sibling note and CLAUDE.md's Games Feature Detail). That stays true for
-- the USER's own data (owned games, playtime, achievements): Steam is the
-- source of truth and React Query's staleTime is all the caching it needs.
--
-- Store METADATA is the one exception, and it's a hard constraint rather
-- than a preference:
--   - `store.steampowered.com/api/appdetails` is rate-limited to roughly
--     200 requests per 5 minutes per IP and returns ~36 KB per app. A
--     400-game library cannot be enriched on every page load; it would
--     exhaust the limit on the first render and take minutes.
--   - The data is CATALOG data, identical for every user and changing only
--     when a publisher edits a store page — exactly the shape this app
--     already caches for TMDB in `movies`/`tv_series` (migration 002).
--
-- So this table mirrors the `movies` pattern: a SHARED catalog keyed by the
-- provider's own id, readable by any authenticated user, written only by
-- the `steam-api` edge function's service-role client. There is no
-- `user_id` column and no owner-only RLS, deliberately — two users looking
-- up the same appid must hit the same cached row, and nothing here is
-- personal (the personal side — what YOU own and how long you played — is
-- never stored, it stays a live passthrough).
--
-- NO `trg_audit`, matching the same bulk-synced exemption `hevy_*`/
-- `health_*` already carry: these rows are refreshed by a sync job, not
-- authored by the user, and auditing them would be pure noise.
--
-- `details` holds the whole `appdetails` `data` object rather than
-- exploding all ~30 of its fields into columns. Only the handful the
-- library actually FILTERS or SORTS on are real columns; everything else
-- (screenshots, movies, price_overview, ratings, platforms, dlc,
-- descriptions, achievements.total) is read out of the jsonb client-side.
-- This is the `health_workouts.raw` precedent: keep the full payload so a
-- later UI addition needs no migration, and promote a field to a column
-- only when a query genuinely needs it.
--
-- Reviews come from a DIFFERENT endpoint (`store.steampowered.com/
-- appreviews/<appid>`) with its own freshness expectation — a review score
-- moves daily, a store page rarely does — so it gets its own
-- `reviews_fetched_at` rather than sharing one timestamp with the details.
--
-- THIS MIGRATION UPDATES NOT ONE EXISTING ROW.

CREATE TABLE IF NOT EXISTS public.steam_apps (
  appid                  integer PRIMARY KEY,

  -- Promoted to columns because the library list filters/sorts on them.
  name                   text,
  type                   text,          -- game | dlc | demo | music | video | hardware
  genres                 text[],
  metacritic_score       integer,
  is_free                boolean,

  -- The complete `appdetails` payload — see header note.
  details                jsonb,
  details_fetched_at     timestamptz,

  -- `appreviews` query_summary, refreshed on its own cadence.
  review_score           integer,       -- 0-9
  review_score_desc      text,          -- "Very Positive", "Mixed", ...
  review_total_positive  integer,
  review_total_negative  integer,
  review_total           integer,
  reviews_fetched_at     timestamptz,

  created_at             timestamptz NOT NULL DEFAULT now(),
  updated_at             timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.steam_apps ENABLE ROW LEVEL SECURITY;

-- Shared catalog: every authenticated user reads the same rows (the
-- `movies` policy shape from migration 002). Writes happen only through
-- the `steam-api` edge function's service-role client, which bypasses RLS
-- — so there is deliberately no INSERT/UPDATE policy for `authenticated`.
DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'steam_apps'
      AND policyname = 'steam_apps_select'
  ) THEN
    CREATE POLICY "steam_apps_select"
      ON public.steam_apps FOR SELECT TO authenticated USING (true);
  END IF;
END $$;

-- The only non-PK lookup the UI performs is "which of these cached rows are
-- stale enough to refetch", which scans by timestamp.
CREATE INDEX IF NOT EXISTS steam_apps_details_fetched_at
  ON public.steam_apps (details_fetched_at);

-- update_updated_at() is defined in 002_media.sql and reused corpus-wide.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_steam_apps_updated_at') THEN
    CREATE TRIGGER trg_steam_apps_updated_at
      BEFORE UPDATE ON public.steam_apps
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
