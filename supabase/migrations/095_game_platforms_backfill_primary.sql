-- ============================================================
-- 095 — every game gets a primary variant
-- ============================================================
-- `game_platforms.is_primary_variant` is what the UI reads to decide which
-- system a game's card shows, and `fetchGamesNeedingReview` flags any game
-- without one. `esde-sync` (migration 093's importer) never set it, so every
-- ES-DE-imported row landed `false` — the whole library had no primary variant
-- and every game was flagged for review on that basis alone.
--
-- Two halves, and both are needed: the edge function is fixed in the same
-- change so new imports set it at insert time, and this backfills the rows
-- already written.
--
-- The pick is deterministic, not arbitrary: the oldest row for a game wins
-- (`created_at`, then `id` to break a same-timestamp tie, which a batch insert
-- makes likely). For the 1125-game ES-DE import that is a single-variant
-- library, so "the oldest" is simply "the only one" almost everywhere.
--
-- Only games with NO primary at all are touched — a variant the user has
-- already chosen by hand is never moved. The partial unique index from 089
-- (`game_platforms(game_id) WHERE is_primary_variant`) stays satisfied because
-- exactly one row per game is set, and only where none was set before.

WITH ranked AS (
  SELECT p.id,
         row_number() OVER (PARTITION BY p.game_id ORDER BY p.created_at, p.id) AS rn
  FROM public.game_platforms p
  WHERE NOT EXISTS (
    SELECT 1 FROM public.game_platforms q
    WHERE q.game_id = p.game_id AND q.is_primary_variant
  )
)
UPDATE public.game_platforms t
SET is_primary_variant = true
FROM ranked
WHERE t.id = ranked.id AND ranked.rn = 1;
