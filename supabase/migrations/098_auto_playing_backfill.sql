-- ============================================================
-- 098 — a game with real hours behind it is not a backlog entry
-- ============================================================
-- Play statistics have only just become visible in the UI (096's neutral
-- columns), and they make an obvious gap obvious: games with hours recorded
-- against them still sat in `backlog`, because nothing ever set a status and
-- `backlog` is the column default.
--
-- Going forward `esde-sync` and the Steam/PlayStation import promote on the
-- same rule. This backfills the rows already here.
--
-- THIRTY MINUTES, not the first launch. Booting a ROM to check it runs is the
-- single most common thing that happens in a retro library, and promoting on
-- that would relabel half the collection as in progress.
--
-- ONLY from 'backlog'. Every other status is something the user actually said
-- — 'completed', 'dropped', 'wishlist' — and a backfill must not argue with
-- one. In particular this cannot un-complete a game that was replayed, which
-- is exactly the shape of mistake that makes an automatic rule untrustworthy.

UPDATE public.games
SET play_status = 'playing'
WHERE play_status = 'backlog'
  AND COALESCE(play_seconds, esde_playtime_seconds, 0) >= 1800;
