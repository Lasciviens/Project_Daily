-- ============================================================
-- 096 — Steam and PlayStation games live in the library too
-- ============================================================
-- Until now `games` held ONLY the retro/ES-DE library. Steam and PlayStation
-- were live passthroughs with no local row at all (see CLAUDE.md's Games
-- Feature Detail), which meant a Steam game could not be marked completed,
-- tiered, queued, rated or counted in Stats — the three tabs were three
-- unrelated views rather than one library.
--
-- Two additions, and deliberately NOT a second table: a Steam game and a SNES
-- game differ in where their metadata came from, not in what they are. The
-- shared columns (play_status, tier, rating, started_at/finished_at, notes)
-- are exactly the ones that make the split painful to maintain twice.

-- ── 1. Which library a row belongs to ──────────────────────────────────────
-- Free-text-with-CHECK rather than an enum, per AGENTS.md rule 7: adding a
-- provider later is an ALTER of one constraint, not a type migration.
-- DEFAULT 'retro' is what makes this backward compatible — every existing row
-- IS retro, and nothing has to be rewritten.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS library text NOT NULL DEFAULT 'retro';

DO $$ BEGIN
  ALTER TABLE public.games
    ADD CONSTRAINT games_library_check CHECK (library IN ('retro', 'steam', 'playstation'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

COMMENT ON COLUMN public.games.library IS
  'Which library this row belongs to: retro (ES-DE/handheld), steam, or playstation. The Retro Games tab shows only ''retro''; Stats can scope to any of them.';

-- ── 2. Source-neutral play statistics ──────────────────────────────────────
-- `esde_playcount`/`esde_playtime_seconds`/`esde_last_played` are ES-DE's own
-- figures and stay exactly as they are (game_platforms carries the per-variant
-- truth, 093). These three are the same facts in one shape every provider can
-- write, so Stats can total a library that mixes all three without knowing
-- which column to read per row.
--
-- Steam reports playtime in MINUTES and PSN as an ISO-8601 duration; both are
-- converted to seconds at the boundary, so this column has one unit.
ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS play_seconds   integer,
  ADD COLUMN IF NOT EXISTS play_count     integer,
  ADD COLUMN IF NOT EXISTS last_played_at timestamptz;

-- Existing rows: the ES-DE roll-up IS their play record.
UPDATE public.games
SET play_seconds   = COALESCE(play_seconds,   esde_playtime_seconds),
    play_count     = COALESCE(play_count,     esde_playcount),
    last_played_at = COALESCE(last_played_at, esde_last_played)
WHERE esde_playtime_seconds IS NOT NULL
   OR esde_playcount IS NOT NULL
   OR esde_last_played IS NOT NULL;

-- ── 3. Two more providers on the existing source CHECK ─────────────────────
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_external_source_check;
ALTER TABLE public.games
  ADD CONSTRAINT games_external_source_check
  CHECK (external_source IN ('screenscraper', 'esde', 'manual', 'steam', 'psn'));

ALTER TABLE public.game_platforms DROP CONSTRAINT IF EXISTS game_platforms_external_source_check;
ALTER TABLE public.game_platforms
  ADD CONSTRAINT game_platforms_external_source_check
  CHECK (external_source IN ('screenscraper', 'esde', 'manual', 'steam', 'psn'));

-- ── 4. Re-importing must update, never duplicate ───────────────────────────
-- The key is (user_id, library, external_ref): a Steam appid and a PSN
-- npTitleId can collide as strings and mean different games, so the library is
-- part of the identity. Partial, because a retro row's external_ref is a
-- ScreenScraper id that is legitimately NULL until it has been scraped — and
-- 'retro' is excluded outright, since two ES-DE variants of one game
-- legitimately share a ScreenScraper id.
CREATE UNIQUE INDEX IF NOT EXISTS games_provider_ref_key
  ON public.games (user_id, library, external_ref)
  WHERE external_ref IS NOT NULL AND library <> 'retro';

CREATE INDEX IF NOT EXISTS games_user_library_idx ON public.games (user_id, library);
