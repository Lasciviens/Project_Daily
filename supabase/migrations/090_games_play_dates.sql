-- ============================================================
-- 090 — games.started_at / finished_at
-- ============================================================
-- Real gap reported the same day 089 shipped: there was no way to answer
-- "when did I start this" / "when did I finish this" for a game, unlike
-- Media's own `started_at`/`finished_at` on `user_tv_entries` (movie
-- completion stamps `watched_at`; TV completion/first-watch stamps
-- `finished_at`/`started_at`). Both columns are plain, manually-editable
-- timestamps — the "quick status switch" UI (see gamesApi.ts::setPlayStatus)
-- auto-fills whichever one is still NULL the first time a game moves into
-- 'playing'/'completed', but never overwrites an already-set date, and the
-- full edit form lets either be corrected or cleared by hand at any time.
--
-- Kept as two plain nullable columns, not a `game_play_sessions` child
-- table — a personal library tracks ONE playthrough's start/finish per
-- game, not a replay history; if replay tracking is ever wanted, that is a
-- genuinely new feature (its own table), not a natural extension of these
-- two columns, so it is deliberately not speculated on here.

ALTER TABLE public.games
  ADD COLUMN IF NOT EXISTS started_at  timestamptz,
  ADD COLUMN IF NOT EXISTS finished_at timestamptz;
