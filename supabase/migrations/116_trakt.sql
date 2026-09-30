-- ============================================================
-- 116 — Trakt integration (docs/trakt/PLAN.md)
-- ============================================================
-- Additive only: new nullable/defaulted columns and new tables. No existing
-- row is updated here — the id backfill happens in the first import, after
-- the owner has seen the dry-run preview.
--
-- Identity rule: one film = one `movies` row, one show = one `tv_series` row,
-- keyed by the existing UNIQUE `tmdb_id`. Trakt/IMDb/TVDB ids are extra
-- columns on that same row, each with a partial unique index so no two rows
-- can ever claim the same external id. `imdb_id` is an identifier only (the
-- key some ratings services use) — no IMDb data is stored.

-- ── Catalogue ids + external ratings ─────────────────────────────────────────
ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS trakt_id           integer,
  ADD COLUMN IF NOT EXISTS trakt_slug         text,
  ADD COLUMN IF NOT EXISTS imdb_id            text,
  ADD COLUMN IF NOT EXISTS rt_critics         smallint,
  ADD COLUMN IF NOT EXISTS rt_audience        smallint,
  ADD COLUMN IF NOT EXISTS metacritic         smallint,
  ADD COLUMN IF NOT EXISTS ratings_fetched_at timestamptz;

ALTER TABLE public.tv_series
  ADD COLUMN IF NOT EXISTS trakt_id           integer,
  ADD COLUMN IF NOT EXISTS trakt_slug         text,
  ADD COLUMN IF NOT EXISTS imdb_id            text,
  ADD COLUMN IF NOT EXISTS tvdb_id            integer,
  ADD COLUMN IF NOT EXISTS rt_critics         smallint,
  ADD COLUMN IF NOT EXISTS rt_audience        smallint,
  ADD COLUMN IF NOT EXISTS metacritic         smallint,
  ADD COLUMN IF NOT EXISTS ratings_fetched_at timestamptz;

CREATE UNIQUE INDEX IF NOT EXISTS movies_trakt_id_key    ON public.movies (trakt_id)    WHERE trakt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS movies_imdb_id_key     ON public.movies (imdb_id)     WHERE imdb_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tv_series_trakt_id_key ON public.tv_series (trakt_id) WHERE trakt_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tv_series_imdb_id_key  ON public.tv_series (imdb_id)  WHERE imdb_id IS NOT NULL;
CREATE UNIQUE INDEX IF NOT EXISTS tv_series_tvdb_id_key  ON public.tv_series (tvdb_id)  WHERE tvdb_id IS NOT NULL;

-- ── Your data: the fields Trakt also holds ──────────────────────────────────
-- repeat_count (already on both entry tables) = extra watches, i.e. Trakt
-- plays − 1. Episodes get the same column so a rewatched episode counts too.
ALTER TABLE public.user_movie_entries
  ADD COLUMN IF NOT EXISTS is_favorite        boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS watchlist_rank     integer,
  ADD COLUMN IF NOT EXISTS trakt_note_id      bigint,
  ADD COLUMN IF NOT EXISTS playback_progress  numeric(5,2),
  ADD COLUMN IF NOT EXISTS playback_paused_at timestamptz,
  ADD COLUMN IF NOT EXISTS trakt_synced_at    timestamptz;

ALTER TABLE public.user_tv_entries
  ADD COLUMN IF NOT EXISTS is_favorite     boolean NOT NULL DEFAULT false,
  ADD COLUMN IF NOT EXISTS watchlist_rank  integer,
  ADD COLUMN IF NOT EXISTS trakt_note_id   bigint,
  ADD COLUMN IF NOT EXISTS trakt_synced_at timestamptz;

ALTER TABLE public.user_tv_episodes
  ADD COLUMN IF NOT EXISTS repeat_count       integer NOT NULL DEFAULT 0,
  ADD COLUMN IF NOT EXISTS trakt_note_id      bigint,
  ADD COLUMN IF NOT EXISTS playback_progress  numeric(5,2),
  ADD COLUMN IF NOT EXISTS playback_paused_at timestamptz;

-- ── trakt_tokens — live secrets ──────────────────────────────────────────────
-- Singleton per user. RLS on with NO policy: only the trakt-api edge
-- function's service-role client ever reads or writes it; the browser sees a
-- derived status. No audit trigger (it would copy a live token into
-- audit_logs) and it must never enter ai-proxy's DB_CATALOG — the psn_tokens rule.
CREATE TABLE IF NOT EXISTS public.trakt_tokens (
  user_id       uuid PRIMARY KEY REFERENCES auth.users(id) ON DELETE CASCADE,
  access_token  text NOT NULL,
  refresh_token text NOT NULL,
  expires_at    timestamptz NOT NULL,
  username      text,
  connected_at  timestamptz NOT NULL DEFAULT now(),
  updated_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trakt_tokens ENABLE ROW LEVEL SECURITY;

-- ── trakt_sync_state — change detection + last run ──────────────────────────
CREATE TABLE IF NOT EXISTS public.trakt_sync_state (
  user_id         uuid PRIMARY KEY DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  last_activities jsonb,
  last_sync_at    timestamptz,
  last_full_at    timestamptz,
  last_error      text,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trakt_sync_state ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trakt_sync_state' AND policyname='Users read own trakt sync state') THEN
    CREATE POLICY "Users read own trakt sync state" ON public.trakt_sync_state
      FOR SELECT USING ((select auth.uid()) = user_id);
  END IF;
END $$;

-- ── trakt_unmatched — Trakt items with no TMDB/IMDb match ───────────────────
-- Never a guessed catalogue row: the Media page offers a manual pick.
CREATE TABLE IF NOT EXISTS public.trakt_unmatched (
  id         uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id    uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind       text NOT NULL CHECK (kind IN ('movie', 'show')),
  trakt_id   integer NOT NULL,
  title      text NOT NULL,
  year       integer,
  ids        jsonb NOT NULL DEFAULT '{}'::jsonb,
  reason     text,
  created_at timestamptz NOT NULL DEFAULT now(),
  UNIQUE (user_id, kind, trakt_id)
);
ALTER TABLE public.trakt_unmatched ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname='public' AND tablename='trakt_unmatched' AND policyname='Users manage own trakt unmatched') THEN
    CREATE POLICY "Users manage own trakt unmatched" ON public.trakt_unmatched
      FOR ALL USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

-- ── trakt_outbox — app → Trakt writes (phase 4) ─────────────────────────────
-- One row per pending change, drained oldest-first per item by the edge
-- function (Trakt allows 1 write per second). Service-role only.
CREATE TABLE IF NOT EXISTS public.trakt_outbox (
  id            uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id       uuid NOT NULL REFERENCES auth.users(id) ON DELETE CASCADE,
  op            text NOT NULL,
  item_key      text NOT NULL,
  payload       jsonb NOT NULL DEFAULT '{}'::jsonb,
  attempts      integer NOT NULL DEFAULT 0,
  next_retry_at timestamptz NOT NULL DEFAULT now(),
  last_error    text,
  created_at    timestamptz NOT NULL DEFAULT now()
);
ALTER TABLE public.trakt_outbox ENABLE ROW LEVEL SECURITY;
CREATE INDEX IF NOT EXISTS trakt_outbox_drain_idx ON public.trakt_outbox (user_id, item_key, created_at);
