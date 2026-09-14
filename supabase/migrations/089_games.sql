-- ============================================================
-- 089 — games + game_platforms (Games feature moves off the separate
--        RP5 Supabase project and into this app's own database)
-- ============================================================
-- The Games feature (`src/features/games/`, `src/features/home/api/gamesApi.ts`)
-- has always read/written a COMPLETELY SEPARATE Supabase project ("RP5" — a
-- personal retro-game library originally built for the Retroid Pocket 5
-- handheld, repo: github.com/Lasciviens/retroid-pocket-5-). That project is
-- being retired; its ~321 games move here so there is only ever one database.
--
-- RP5's own schema was 11 tables + 5 views (systems/genres/series/emulators
-- lookup tables, emulator_systems/game_genres junctions, games/game_platforms
-- mains, notes/glossary, plus a temporary game_ss staging table and 5 SQL
-- views for list/detail/audit). This migration deliberately collapses that
-- down to the 2 tables below — see the "collapsed away" note on each column
-- group for exactly what happened to each piece and why:
--
--   - systems/emulators/emulator_systems  → plain `text` columns on
--     game_platforms (`system`, `emulator`). Single user, ~14 known systems,
--     no multi-tenant reuse pressure — the same reasoning this app already
--     applies to `athlete_limitations.movement_pattern` (a fixed CHECK list
--     would force a redeploy for every new phrasing; free text costs nothing
--     here since nothing server-side validates against it).
--   - genres        → `games.genres text[]`. RP5's own `v_games_summary`/
--     `v_games_full` already served genres to the client as a flat string
--     array — the normalized join was pure backend plumbing the client never
--     saw structured, so collapsing it loses nothing observable.
--   - series        → `games.series_name text`. The "Series Roadmap" grouping
--     becomes a client-side GROUP BY over already-fetched games (this app's
--     own aggregation-module convention — progressAggregate.ts et al. —
--     rather than a SQL view).
--   - game_genres, roms (dropped from RP5 itself years ago), game_media_assets
--     (created in RP5's history, never referenced by any surviving RP5 code —
--     orphaned) → not carried forward at all.
--   - notes (category='request'/'done')  → folds into this app's existing
--     `dev_requests` (page='games'), not a new table.
--   - notes (category='tip'), glossary    → not modeled as tables; kept (if
--     at all) as static reference content, since neither had any observed
--     write UI in RP5's own surviving code.
--   - game_ss (RP5's ScreenScraper-matching staging table)  → never carried
--     over; it was already a temporary landing zone whose whole purpose ends
--     once matched data is folded into game_platforms' own ss-shaped columns
--     below.
--   - v_games_summary/v_games_full/v_games_cleanup/v_games_audit/
--     v_game_platform_audit (5 SQL views)  → none recreated. The two list/
--     detail views become plain `select('*')` + client-side TypeScript
--     aggregation (this app's established pattern); the 3 audit/cleanup views
--     were RP5's own one-time cataloguing QA tooling (18 heuristic rules,
--     see RP5's docs/audit_system.md), not an ongoing personal-use feature —
--     not ported. If a one-off "what's missing metadata" check is ever
--     wanted, it belongs in a throwaway scripts/*.cjs run, per this repo's
--     own no-unit-test-framework convention — not a permanent view.
--
-- `is_preferred` (RP5's game_platforms) is dropped outright — RP5's own
-- audit system flagged rows where it disagreed with `is_primary_variant`,
-- which is evidence of accumulated inconsistency, not a deliberate two-flag
-- design. `is_primary_variant` alone survives, DB-enforced via the partial
-- unique index below (mirrors `time_blocks.task_id`'s own "at most one" shape
-- from migration 077).
--
-- `rom_status`/`rom_url`/`folder_path` are kept as columns (a personal
-- library legitimately might want "do I have this ROM on the device"), but
-- every row in RP5's live data was reset to NULL and never repopulated — this
-- migration inherits an already-blank field, not a real loss.
--
-- IGDB (RP5's original, now-legacy metadata provider) columns are NOT carried
-- over — RP5's own migration history (project_todo.md Phase 4) already
-- planned to retire them once ScreenScraper coverage was verified; there is
-- no reason to import technical debt RP5 itself was trying to shed. If a
-- ScreenScraper-unmatched game genuinely needs a rating fallback, `rating`
-- (the user's own score) and the ScreenScraper-shaped columns below are the
-- only rating surfaces this schema offers going forward.
--
-- ScreenScraper-shaped columns (`age_rating`/`players`/`modes`/
-- `screenshot_url`/`fanart_url` on games; `rating`/`release_date`/`box_url`/
-- `wheel_url` on game_platforms) are NOT a speculative guess at an external
-- API shape — RP5's own migration_v16.sql added and ran these same fields
-- against ScreenScraper in production. `external_ref`/`external_source`/
-- `synced_at`/`needs_review` (on both tables) are a deliberately provider-
-- neutral pair replacing RP5's `ss_`-prefixed equivalents now that
-- ScreenScraper is the only provider — `external_source` stays a plain CHECK
-- list, not an enum, exactly for the reason this app always prefers CHECK:
-- trivially extendable later (e.g. an 'esde' source) with a plain ALTER.
--
-- `esde_playcount`/`esde_last_played`/`esde_playtime_seconds` on `games` are
-- for a planned, separate, manually-triggered (never an unattended cron —
-- see the chat record for why) sync of small play-statistics from the user's
-- own EmulationStation-DE `gamelist.xml` files (`<playcount>`/`<lastplayed>`/
-- `<playtime>`, confirmed against a real exported sample). Nothing writes
-- these yet; they exist so that a future sync script needs no further
-- migration.
--
-- This migration deliberately does NOT import any data — the ~321 RP5 rows
-- move over in a separate, later data-backfill step once ScreenScraper field
-- names are confirmed against a real API response and the RP6 device's own
-- already-scraped file layout is inspected. Both tables are created empty;
-- the live Games feature keeps reading the OLD separate RP5 project until
-- that backfill lands — see gamesApi.ts, unchanged by this migration.

CREATE TABLE IF NOT EXISTS public.games (
  id                    uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id               uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,

  title                 text NOT NULL,
  release_year          integer,
  publisher             text,
  developer             text,
  description           text,
  storyline             text,

  -- Collapsed from RP5's genres/game_genres tables — see header note.
  genres                text[],
  -- Collapsed from RP5's series table + games.series_id FK — see header note.
  series_name           text,

  play_status           text NOT NULL DEFAULT 'backlog'
                         CHECK (play_status IN ('playing', 'completed', 'wishlist', 'backlog', 'dropped')),
  tier                  text
                         CHECK (tier IN ('S', 'A', 'B', 'C', 'D', 'F')),
  rating                numeric(3, 1) CHECK (rating BETWEEN 0 AND 10),
  -- Play Queue order. NULL = not queued. No DEFAULT/sequence — the queue's
  -- own reorder/add-to-queue logic assigns the next value (mirrors RP5's own
  -- "max(play_order)+1" approach, kept in the rewritten gamesApi.ts).
  play_order            integer,

  is_coop               boolean NOT NULL DEFAULT false,
  coop_notes            text,
  is_iconic             boolean NOT NULL DEFAULT false,
  play_notes            text,
  game_log              text,

  primary_cover_url     text,

  -- ScreenScraper-shaped fields (see header note — not speculative, RP5 ran
  -- these live). `_esde` prefix intentionally NOT used here: these are
  -- provider-neutral once ScreenScraper is the sole metadata source.
  age_rating            text,
  players               text,
  modes                 text[],
  screenshot_url        text,
  fanart_url            text,

  -- Provider-neutral sync bookkeeping — replaces RP5's `ss_`-prefixed
  -- equivalents. CHECK, not enum, per this app's standing rule.
  external_ref          text,
  external_source       text CHECK (external_source IN ('screenscraper', 'esde', 'manual')),
  synced_at             timestamptz,
  needs_review          boolean NOT NULL DEFAULT false,

  -- EmulationStation-DE play-statistics sync target — see header note. Empty
  -- until the (separate, manually-triggered) ES-DE sync exists.
  esde_playcount        integer,
  esde_last_played      timestamptz,
  esde_playtime_seconds integer,

  created_at            timestamptz NOT NULL DEFAULT now(),
  updated_at            timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.games ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'games'
      AND policyname = 'Users manage own games'
  ) THEN
    CREATE POLICY "Users manage own games"
      ON public.games
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- Library/queue/tier filters all key off (user_id, play_status); the queue
-- itself sorts by play_order within that same scope, so one composite index
-- covers both real query shapes (AGENTS.md rule 8: index what's actually
-- filtered/sorted on).
CREATE INDEX IF NOT EXISTS games_user_play_status
  ON public.games (user_id, play_status);
CREATE INDEX IF NOT EXISTS games_user_play_order
  ON public.games (user_id, play_order) WHERE play_order IS NOT NULL;

DROP TRIGGER IF EXISTS trg_audit ON public.games;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.games
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- update_updated_at() is defined in 002_media.sql and reused corpus-wide.
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_games_updated_at') THEN
    CREATE TRIGGER trg_games_updated_at
      BEFORE UPDATE ON public.games
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;

-- ============================================================
-- game_platforms — one row per (game × system × emulator) variant
-- ============================================================
-- Kept as a REAL child table, not collapsed into a `games.platforms jsonb`
-- column, for three concrete reasons (see the full chat record for the
-- longer version): (1) `is_primary_variant` needs a DB-enforced "at most one
-- per game" invariant, which a jsonb array cannot give without duplicating
-- the check into application code; (2) a game genuinely can have more than
-- one system/emulator variant (RP5's own migration_v13 merged two DUPLICATE
-- *game* rows that each legitimately held their own platform variant — e.g.
-- a title played on both GameCube and PSP — so multi-variant-per-game is a
-- real, intentional shape, not an edge case); (3) the planned manual-trigger
-- sync scripts (ScreenScraper re-match, ES-DE stats) want a stable
-- `(game_id, system)`-shaped row to UPSERT against — a targeted single-row
-- UPDATE, not a read-modify-write of an entire jsonb array on every sync.

CREATE TABLE IF NOT EXISTS public.game_platforms (
  id                 uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id            uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  game_id            uuid NOT NULL REFERENCES public.games(id) ON DELETE CASCADE,

  -- Collapsed from RP5's systems/emulators lookup tables — see the top-level
  -- header note. Free text, not CHECK: same "no server-side validator, no
  -- reuse pressure, don't force a redeploy per new value" reasoning as
  -- athlete_limitations.movement_pattern.
  system             text NOT NULL,
  emulator           text,
  -- Unlike `system`/`emulator`, this dimension genuinely IS closed (there are
  -- only two kinds of emulator architecture) — a real CHECK, not free text.
  emulator_type      text CHECK (emulator_type IN ('standalone', 'retroarch_core')),

  performance        text CHECK (performance IN ('good', 'warn', 'bad')),
  performance_notes  text,
  cover_url          text,
  region             text,

  -- Kept as columns; every RP5 row for these was already NULL (an abandoned
  -- workflow, not real data) — see header note.
  rom_status         text CHECK (rom_status IN ('missing', 'found', 'verified', 'installed', 'sd_card')),
  rom_url            text,
  folder_path        text,

  -- Exactly one true per game_id, enforced below by a partial unique index.
  is_primary_variant boolean NOT NULL DEFAULT false,
  version_title      text,

  -- ScreenScraper-shaped, per-variant fields (see header note).
  rating             numeric(4, 1) CHECK (rating BETWEEN 0 AND 100),
  release_date       date,
  box_url            text,
  wheel_url          text,

  external_ref       text,
  external_source    text CHECK (external_source IN ('screenscraper', 'esde', 'manual')),
  synced_at          timestamptz,
  needs_review       boolean NOT NULL DEFAULT false,

  created_at         timestamptz NOT NULL DEFAULT now(),
  updated_at         timestamptz NOT NULL DEFAULT now()
);

ALTER TABLE public.game_platforms ENABLE ROW LEVEL SECURITY;

DO $$ BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_policies
    WHERE schemaname = 'public' AND tablename = 'game_platforms'
      AND policyname = 'Users manage own game platforms'
  ) THEN
    CREATE POLICY "Users manage own game platforms"
      ON public.game_platforms
      FOR ALL
      USING ((select auth.uid()) = user_id)
      WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- The real invariant this table exists to enforce (see the table's own
-- header note) — mirrors time_blocks.task_id's own "at most one" partial
-- unique index shape from migration 077.
CREATE UNIQUE INDEX IF NOT EXISTS game_platforms_one_primary_per_game
  ON public.game_platforms (game_id) WHERE is_primary_variant = true;

-- Every read is "this game's platforms" (detail view) or "this user's
-- platforms" (a future sync script's own scope) — no separate lookup shape.
CREATE INDEX IF NOT EXISTS game_platforms_game_id
  ON public.game_platforms (game_id);
CREATE INDEX IF NOT EXISTS game_platforms_user_id
  ON public.game_platforms (user_id);

DROP TRIGGER IF EXISTS trg_audit ON public.game_platforms;
CREATE TRIGGER trg_audit
  AFTER INSERT OR UPDATE OR DELETE ON public.game_platforms
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_trigger WHERE tgname = 'trg_game_platforms_updated_at') THEN
    CREATE TRIGGER trg_game_platforms_updated_at
      BEFORE UPDATE ON public.game_platforms
      FOR EACH ROW EXECUTE FUNCTION update_updated_at();
  END IF;
END $$;
