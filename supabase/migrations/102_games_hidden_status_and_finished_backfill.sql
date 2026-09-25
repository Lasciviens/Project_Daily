-- ============================================================
-- 102 — games.play_status gains 'hidden'; finished_at backfilled
-- ============================================================
-- TWO changes, both about a status column that was slightly too narrow and a
-- date column that was being filled with the wrong day.
--
-- 1. 'hidden' becomes a real play_status.
--
--    Provider libraries carry rows that are not games at all — Netflix, a
--    store launcher, a benchmark tool. Until now the only way to keep them
--    out of the grid was a CLIENT-SIDE toggle keyed off the provider's own
--    `type`/`category`, which meant the decision lived nowhere, could not be
--    made per title, and reset on every device.
--
--    Storing it as a STATUS rather than a separate `hidden boolean` is the
--    user's explicit call ("bu da status içine kaydolsun; statüsü okuyup
--    karar versin UI"). The trade-off is real and worth stating: a row can
--    hold exactly one status, so hiding a title replaces whatever play status
--    it had, and un-hiding has to pick a new one. For the rows this exists
--    for — apps and launchers that were never going to be "backlog" or
--    "completed" — that costs nothing.
--
-- 2. finished_at is backfilled from last_played_at.
--
--    `setPlayStatus` stamped `finished_at = now()` the first time a game moved
--    to 'completed'. That is the day you PRESSED THE BUTTON, not the day you
--    finished the game — and for an imported Steam/PSN library, where you mark
--    a hundred old games completed in one sitting, it collapses a decade of
--    play history onto one afternoon. The last session the provider recorded
--    is the honest answer.
--
--    Only rows that have no finished_at yet are touched, and only where the
--    provider actually reported a last session: a row with neither keeps its
--    NULL rather than inventing a date. Nothing already recorded is
--    overwritten — a manually corrected date is the user's, not ours.

-- ── 1. Widen the status CHECK ────────────────────────────────────────────────
-- The constraint is recreated rather than altered (Postgres has no ALTER
-- CONSTRAINT for a CHECK expression). Dropped by its generated name from 089;
-- IF EXISTS keeps this idempotent.
ALTER TABLE public.games DROP CONSTRAINT IF EXISTS games_play_status_check;

ALTER TABLE public.games
  ADD CONSTRAINT games_play_status_check
  CHECK (play_status IN ('playing', 'completed', 'wishlist', 'backlog', 'dropped', 'hidden'));

-- ── 2. Backfill finished_at from the real last session ───────────────────────
UPDATE public.games
   SET finished_at = last_played_at
 WHERE play_status = 'completed'
   AND finished_at IS NULL
   AND last_played_at IS NOT NULL;

COMMENT ON COLUMN public.games.finished_at IS
  'When this playthrough ended. Stamped once from the provider''s own '
  'last_played_at when a game is marked completed (falling back to now() only '
  'when the provider reported no session), and never overwritten afterwards.';
