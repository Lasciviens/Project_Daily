-- 120 — Media: cinema visits, keyword smart lists, date changes reach Trakt.
-- Additive; updates no existing row. Safe to re-run.
--
-- 1. movie_cinema_visits: a movie watched at a cinema — which cinema, where,
--    with whom, what it cost (amount + currency) and a note. One row per
--    visit, so a second trip to the cinema is its own row. Owner-only RLS,
--    trg_audit like every user-authored table.
-- 2. media_follows.kind gains 'keyword' (a TMDB keyword, e.g. a cinematic
--    universe) so a smart list can collect every film tagged with it.
-- 3. The Trakt outbox triggers (117) sent nothing when only a watched DATE
--    changed, and the next sync then put Trakt's old date back. A changed
--    date on a completed movie or a watched episode now removes its plays on
--    Trakt and sends them again at the new date (every play gets the new
--    date: the app keeps one date per title/episode; the UI says so first).
-- 4. trakt_outbox.seq: rows written by one trigger call share created_at
--    (now() is the transaction time), so "remove plays" and "add plays" could
--    drain in either order and lose plays. The drain orders by seq.

CREATE TABLE IF NOT EXISTS public.movie_cinema_visits (
  id          uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id     uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  -- RESTRICT: `movies` is the shared catalogue; tidying it must never delete someone's visits.
  movie_id    uuid NOT NULL REFERENCES public.movies(id) ON DELETE RESTRICT,
  watched_on  date,
  cinema      text,
  location    text,
  companions  text,
  cost        numeric(10,2) CHECK (cost IS NULL OR cost >= 0),
  currency    text NOT NULL DEFAULT 'NOK' CHECK (currency IN ('NOK', 'TRY', 'EUR', 'USD')),
  note        text,
  created_at  timestamptz NOT NULL DEFAULT now(),
  updated_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX IF NOT EXISTS movie_cinema_visits_user_movie_idx ON public.movie_cinema_visits (user_id, movie_id);

ALTER TABLE public.movie_cinema_visits ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'movie_cinema_visits' AND policyname = 'Users manage own cinema visits') THEN
    CREATE POLICY "Users manage own cinema visits" ON public.movie_cinema_visits FOR ALL
      USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;

DROP TRIGGER IF EXISTS trg_movie_cinema_visits_updated_at ON public.movie_cinema_visits;
CREATE TRIGGER trg_movie_cinema_visits_updated_at BEFORE UPDATE ON public.movie_cinema_visits
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_audit ON public.movie_cinema_visits;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.movie_cinema_visits
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

ALTER TABLE public.trakt_outbox ADD COLUMN IF NOT EXISTS seq bigserial;
CREATE INDEX IF NOT EXISTS trakt_outbox_seq_idx ON public.trakt_outbox (user_id, seq);

ALTER TABLE public.media_follows DROP CONSTRAINT IF EXISTS media_follows_kind_check;
ALTER TABLE public.media_follows ADD CONSTRAINT media_follows_kind_check
  CHECK (kind IN ('collection', 'company', 'director', 'actor', 'keyword'));

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
  ELSIF n_status = 'completed' AND o_status = 'completed' AND n_rep = o_rep
        AND NEW.watched_at IS DISTINCT FROM OLD.watched_at THEN
    -- A changed watched date (120): Trakt keeps one row per play, so its plays
    -- are removed and sent again at the new date (NULL = unknown date).
    PERFORM public.trakt_enqueue(v_user, 'history_remove', v_key, v_base);
    FOR i IN 1 .. (n_rep + 1) LOOP
      PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at',
        CASE WHEN NEW.watched_at IS NULL THEN timestamptz '1970-01-01 00:00:00+00' + make_interval(secs => i - 1)
             ELSE NEW.watched_at - make_interval(mins => i - 1) END));
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
  IF o_at IS NOT NULL AND n_at IS DISTINCT FROM o_at AND n_rep = o_rep THEN
    -- A changed watched date (120): resend this episode's plays at the new date.
    PERFORM public.trakt_enqueue(v_user, 'history_remove', v_key, v_base);
    FOR i IN 1 .. (n_rep + 1) LOOP
      PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at',
        CASE WHEN n_at < timestamptz '1971-01-01 00:00:00+00' THEN n_at + make_interval(secs => i - 1)
             ELSE n_at - make_interval(mins => i - 1) END));
    END LOOP;
    RETURN NULL;
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
