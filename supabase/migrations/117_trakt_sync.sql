-- ============================================================
-- 117 — Trakt automatic sync (docs/trakt/PLAN.md phases 3–4)
-- ============================================================
-- 1. Unknown watch dates: Trakt stores "unknown date" as 01.01.1970. Movies
--    keep NULL instead (their status already says "watched"). Episodes keep
--    the epoch, because on user_tv_episodes a NULL watched_at means "not
--    watched" to every reader. The one-time fix below runs BEFORE the
--    outbox triggers exist, so it is not sent back to Trakt.
-- 2. The outbox: every change to a Trakt-held fact (watched, plays, rating,
--    watchlist, dropped) made by ANY writer — the web app, the AI, a SQL
--    edit — queues one row in trakt_outbox, which trakt-api sends to Trakt
--    before it reads Trakt back. Writes made by the sync itself carry the
--    `x-trakt-sync: 1` request header and are skipped, so nothing loops.
--    Nothing is queued while Trakt is not connected.
-- 3. A lock + last result on trakt_sync_state, and the 30-minute cron.

-- ── 1. Unknown movie dates → NULL ────────────────────────────────────────────
UPDATE public.user_movie_entries SET watched_at = NULL WHERE watched_at < '1971-01-01';

-- ── 3a. Sync state: lock + last result ──────────────────────────────────────
ALTER TABLE public.trakt_sync_state
  ADD COLUMN IF NOT EXISTS sync_started_at timestamptz,
  ADD COLUMN IF NOT EXISTS last_result     jsonb;

-- ── 2. The outbox triggers ───────────────────────────────────────────────────
-- A write made by trakt-api itself (PostgREST exposes request headers as the
-- `request.headers` setting), or inside a transaction that set
-- app.trakt_sync = 'on', is not queued.
CREATE OR REPLACE FUNCTION public.trakt_sync_writing() RETURNS boolean
LANGUAGE sql STABLE AS $$
  SELECT coalesce(nullif(current_setting('request.headers', true), '')::jsonb ->> 'x-trakt-sync', '') = '1'
      OR coalesce(current_setting('app.trakt_sync', true), '') = 'on'
$$;

CREATE OR REPLACE FUNCTION public.trakt_enqueue(p_user uuid, p_op text, p_key text, p_payload jsonb)
RETURNS void LANGUAGE sql SECURITY DEFINER SET search_path = public AS $$
  INSERT INTO public.trakt_outbox (user_id, op, item_key, payload) VALUES (p_user, p_op, p_key, p_payload)
$$;
REVOKE ALL ON FUNCTION public.trakt_enqueue(uuid, text, text, jsonb) FROM PUBLIC, anon, authenticated;

-- Movies: watched (status completed), extra plays, watchlist, rating.
-- Moving to Wishlist (or removing the title) removes its plays on Trakt;
-- Completed → Watching/Dropped keeps them (a rewatch, or a stop).
CREATE OR REPLACE FUNCTION public.trakt_outbox_movie() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_tmdb integer;
  v_key text;
  o_status text := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  n_status text := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.status END;
  o_rating integer := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.rating END;
  n_rating integer := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.rating END;
  o_rep integer := CASE WHEN TG_OP = 'INSERT' THEN 0 ELSE coalesce(OLD.repeat_count, 0) END;
  n_rep integer := CASE WHEN TG_OP = 'DELETE' THEN 0 ELSE coalesce(NEW.repeat_count, 0) END;
  v_base jsonb;
  v_at timestamptz;
BEGIN
  IF public.trakt_sync_writing() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trakt_tokens WHERE user_id = v_user) THEN RETURN NULL; END IF;
  SELECT tmdb_id INTO v_tmdb FROM public.movies
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.movie_id ELSE NEW.movie_id END;
  IF v_tmdb IS NULL THEN RETURN NULL; END IF;
  v_key := 'movie:' || v_tmdb;
  v_base := jsonb_build_object('type', 'movie', 'tmdb', v_tmdb);

  IF n_status = 'completed' AND o_status IS DISTINCT FROM 'completed' THEN
    PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at', NEW.watched_at));
  ELSIF n_status = 'completed' AND n_rep > o_rep THEN
    v_at := CASE WHEN NEW.watched_at IS DISTINCT FROM OLD.watched_at AND NEW.watched_at IS NOT NULL THEN NEW.watched_at ELSE now() END;
    FOR i IN 1 .. (n_rep - o_rep) LOOP
      PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at', v_at - make_interval(mins => i - 1)));
    END LOOP;
  ELSIF TG_OP = 'DELETE'
     OR (TG_OP = 'UPDATE' AND n_status IN ('wishlist', 'upcoming') AND o_status NOT IN ('wishlist', 'upcoming')) THEN
    -- Want-to-watch (or gone) means no plays: harmless when Trakt had none.
    PERFORM public.trakt_enqueue(v_user, 'history_remove', v_key, v_base);
  END IF;

  IF coalesce(n_status IN ('wishlist', 'upcoming'), false) AND NOT coalesce(o_status IN ('wishlist', 'upcoming'), false) THEN
    PERFORM public.trakt_enqueue(v_user, 'watchlist_add', v_key, v_base);
  ELSIF coalesce(o_status IN ('wishlist', 'upcoming'), false) AND NOT coalesce(n_status IN ('wishlist', 'upcoming'), false) THEN
    PERFORM public.trakt_enqueue(v_user, 'watchlist_remove', v_key, v_base);
  END IF;

  IF n_rating IS DISTINCT FROM o_rating THEN
    IF n_rating IS NULL THEN
      PERFORM public.trakt_enqueue(v_user, 'rating_remove', v_key, v_base);
    ELSE
      PERFORM public.trakt_enqueue(v_user, 'rating_add', v_key, v_base || jsonb_build_object('rating', n_rating));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Shows: watchlist, dropped, rating. Watched episodes are their own rows.
CREATE OR REPLACE FUNCTION public.trakt_outbox_show() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_tmdb integer;
  v_key text;
  o_status text := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.status END;
  n_status text := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.status END;
  o_rating integer := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.rating END;
  n_rating integer := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.rating END;
  v_base jsonb;
BEGIN
  IF public.trakt_sync_writing() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trakt_tokens WHERE user_id = v_user) THEN RETURN NULL; END IF;
  SELECT tmdb_id INTO v_tmdb FROM public.tv_series
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tv_series_id ELSE NEW.tv_series_id END;
  IF v_tmdb IS NULL THEN RETURN NULL; END IF;
  v_key := 'show:' || v_tmdb;
  v_base := jsonb_build_object('type', 'show', 'tmdb', v_tmdb);

  IF n_status = 'wishlist' AND o_status IS DISTINCT FROM 'wishlist' THEN
    PERFORM public.trakt_enqueue(v_user, 'watchlist_add', v_key, v_base);
  ELSIF o_status = 'wishlist' AND n_status IS DISTINCT FROM 'wishlist' THEN
    PERFORM public.trakt_enqueue(v_user, 'watchlist_remove', v_key, v_base);
  END IF;

  IF n_status = 'dropped' AND o_status IS DISTINCT FROM 'dropped' THEN
    PERFORM public.trakt_enqueue(v_user, 'dropped_add', v_key, v_base);
  ELSIF o_status = 'dropped' AND n_status IS DISTINCT FROM 'dropped' THEN
    PERFORM public.trakt_enqueue(v_user, 'dropped_remove', v_key, v_base);
  END IF;

  IF n_rating IS DISTINCT FROM o_rating THEN
    IF n_rating IS NULL THEN
      PERFORM public.trakt_enqueue(v_user, 'rating_remove', v_key, v_base);
    ELSE
      PERFORM public.trakt_enqueue(v_user, 'rating_add', v_key, v_base || jsonb_build_object('rating', n_rating));
    END IF;
  END IF;
  RETURN NULL;
END;
$$;

-- Episodes: a watched row = one play; repeat_count + 1 = one more play;
-- deleting it (Not watched) removes its plays on Trakt.
CREATE OR REPLACE FUNCTION public.trakt_outbox_episode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_tmdb integer;
  v_key text;
  v_base jsonb;
  o_at timestamptz := CASE WHEN TG_OP = 'INSERT' THEN NULL ELSE OLD.watched_at END;
  n_at timestamptz := CASE WHEN TG_OP = 'DELETE' THEN NULL ELSE NEW.watched_at END;
  o_rep integer := CASE WHEN TG_OP = 'INSERT' OR OLD.watched_at IS NULL THEN 0 ELSE coalesce(OLD.repeat_count, 0) END;
  n_rep integer := CASE WHEN TG_OP = 'DELETE' THEN 0 ELSE coalesce(NEW.repeat_count, 0) END;
  v_at timestamptz;
  v_s integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.season_number ELSE NEW.season_number END;
  v_e integer := CASE WHEN TG_OP = 'DELETE' THEN OLD.episode_number ELSE NEW.episode_number END;
BEGIN
  IF public.trakt_sync_writing() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trakt_tokens WHERE user_id = v_user) THEN RETURN NULL; END IF;
  SELECT tmdb_id INTO v_tmdb FROM public.tv_series
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tv_series_id ELSE NEW.tv_series_id END;
  IF v_tmdb IS NULL THEN RETURN NULL; END IF;
  v_key := 'ep:' || v_tmdb || ':' || v_s || ':' || v_e;
  v_base := jsonb_build_object('type', 'episode', 'tmdb', v_tmdb, 'season', v_s, 'episode', v_e);

  IF o_at IS NOT NULL AND n_at IS NULL THEN
    PERFORM public.trakt_enqueue(v_user, 'history_remove', v_key, v_base);
    RETURN NULL;
  END IF;
  IF n_at IS NULL THEN RETURN NULL; END IF;

  IF o_at IS NULL THEN
    PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at', n_at));
  END IF;
  IF n_rep > o_rep THEN
    v_at := CASE WHEN o_at IS NULL THEN n_at - interval '1 minute'
                 WHEN n_at IS DISTINCT FROM o_at THEN n_at ELSE now() END;
    FOR i IN 1 .. (n_rep - o_rep) LOOP
      PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at', v_at - make_interval(mins => i - 1)));
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trakt_outbox_movie ON public.user_movie_entries;
CREATE TRIGGER trg_trakt_outbox_movie AFTER INSERT OR UPDATE OF status, rating, repeat_count, watched_at OR DELETE
  ON public.user_movie_entries FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_movie();

DROP TRIGGER IF EXISTS trg_trakt_outbox_show ON public.user_tv_entries;
CREATE TRIGGER trg_trakt_outbox_show AFTER INSERT OR UPDATE OF status, rating OR DELETE
  ON public.user_tv_entries FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_show();

DROP TRIGGER IF EXISTS trg_trakt_outbox_episode ON public.user_tv_episodes;
CREATE TRIGGER trg_trakt_outbox_episode AFTER INSERT OR UPDATE OF watched_at, repeat_count OR DELETE
  ON public.user_tv_episodes FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_episode();

-- Pending rows per user in send order.
CREATE INDEX IF NOT EXISTS trakt_outbox_order_idx ON public.trakt_outbox (user_id, created_at, id);

-- ── 3b. Cron — every 30 minutes (at :07 and :37, off the busy hour mark) ────
-- The secret is read from Vault inside the cron body (the 068/072 rule).
SELECT cron.unschedule('lascis-trakt-sync') WHERE EXISTS (SELECT 1 FROM cron.job WHERE jobname = 'lascis-trakt-sync');
SELECT cron.schedule('lascis-trakt-sync', '7,37 * * * *', $cron$
  select net.http_post(
    url := 'https://hsaedwwqpcjizeozjbch.supabase.co/functions/v1/trakt-api',
    headers := jsonb_build_object(
      'Content-Type', 'application/json',
      'x-sync-secret', coalesce((select decrypted_secret from vault.decrypted_secrets where name = 'TRAKT_SYNC_SECRET'), '')
    ),
    body := '{"action":"sync"}'::jsonb
  );
$cron$);
