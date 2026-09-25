-- ============================================================
-- 103 — repair finished_at dates stamped at button-press time
-- ============================================================
-- Migration 102 backfilled finished_at from the last session, but ONLY for
-- completed rows whose finished_at was still NULL. The rows the owner actually
-- complained about were not NULL: the old `setPlayStatus` had already stamped
-- them with now() when they were marked completed — many in one sitting — so
-- 102 skipped every one of them and they kept sharing one afternoon's date.
--
-- The rule here: a playthrough cannot end AFTER the last time the game was
-- played. A finished_at more than a day later than the game's own last
-- session is therefore the day the button was pressed, and is replaced by
-- that last session. The day of slack keeps a same-evening mark (finished at
-- 23:50, last session reported at 00:10 UTC) and a hand-entered date on the
-- last-played day untouched.
--
-- "Last session" matches the app's `playStatsOf`: the later of the neutral
-- `last_played_at` (Steam/PSN, migration 096) and ES-DE's live
-- `esde_last_played` for retro rows. A row with no recorded session keeps
-- whatever it has — nothing better is known. Idempotent: a repaired row no
-- longer matches the WHERE clause.

UPDATE public.games g
   SET finished_at = s.last_session
  FROM (
    SELECT id, GREATEST(last_played_at, esde_last_played) AS last_session
      FROM public.games
  ) s
 WHERE g.id = s.id
   AND g.play_status = 'completed'
   AND s.last_session IS NOT NULL
   AND g.finished_at IS NOT NULL
   AND g.finished_at > s.last_session + interval '1 day';
