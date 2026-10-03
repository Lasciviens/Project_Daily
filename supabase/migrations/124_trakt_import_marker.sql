-- ─────────────────────────────────────────────────────────────────────────────
-- 124 — Trakt: the sync waits for the first import.
--
-- trakt-api's `sync` mirrors Trakt into the library as the truth (additions
-- AND removals). Run before the first import — by the cron, the outbox drain
-- or the sync a media edit schedules — it wiped ratings and dropped states
-- and deleted what only the app held. The sync now refuses until a fully
-- successful import has stamped trakt_sync_state.imported_at (the cron skips
-- quietly; the app gets a named error). Disconnecting clears it, so a new
-- connection starts with an import again.
--
-- Backfill: until now last_full_at was written only by an import or by a full
-- "Sync now", so an existing row with last_full_at has been imported.
-- Updates only trakt_sync_state rows that already have last_full_at.
-- Without this migration trakt-api falls back to last_full_at.
-- ─────────────────────────────────────────────────────────────────────────────

ALTER TABLE public.trakt_sync_state
  ADD COLUMN IF NOT EXISTS imported_at timestamptz;

UPDATE public.trakt_sync_state
   SET imported_at = last_full_at
 WHERE imported_at IS NULL
   AND last_full_at IS NOT NULL;
