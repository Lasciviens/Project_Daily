-- 132 — Play counts reach Trakt in both directions. Updates no row. Safe to re-run.
--
-- The outbox triggers (117, 120) only handled MORE plays: a lower
-- repeat_count (e.g. "watched 3 times" corrected to 1) queued nothing, so
-- Trakt kept the old plays and the next sync put the old count back here.
-- Extra plays added without a new date were also sent at now(), so Trakt
-- showed today for a rewatch the user had dated in the past.
--
-- Now, for a completed movie or a watched episode:
--   · fewer plays                → remove its plays on Trakt and send the new
--                                  number again at the kept date;
--   · same plays, new date       → the same (unchanged from 120);
--   · more plays                 → add only the extra plays, at the new date
--                                  when it changed, else at the kept date;
--   · first completion of a movie with plays > 1 sends every play.
-- A NULL movie date / an epoch episode date is "date unknown": plays are sent
-- at the epoch, one second apart, like 120.

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
  v_date_changed boolean := TG_OP = 'UPDATE' AND NEW.watched_at IS DISTINCT FROM OLD.watched_at;
BEGIN
  IF public.trakt_sync_writing() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trakt_tokens WHERE user_id = v_user) THEN RETURN NULL; END IF;
  SELECT tmdb_id INTO v_tmdb FROM public.movies
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.movie_id ELSE NEW.movie_id END;
  IF v_tmdb IS NULL THEN RETURN NULL; END IF;
  v_key := 'movie:' || v_tmdb;
  v_base := jsonb_build_object('type', 'movie', 'tmdb', v_tmdb);

  IF n_status = 'completed' AND o_status IS DISTINCT FROM 'completed' THEN
    FOR i IN 1 .. (n_rep + 1) LOOP
      PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at',
        CASE WHEN NEW.watched_at IS NULL THEN timestamptz '1970-01-01 00:00:00+00' + make_interval(secs => i - 1)
             ELSE NEW.watched_at - make_interval(mins => i - 1) END));
    END LOOP;
  ELSIF n_status = 'completed' AND n_rep > o_rep THEN
    -- Extra plays only, at the new date when it changed, else at the kept date.
    FOR i IN 1 .. (n_rep - o_rep) LOOP
      PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at',
        CASE WHEN NEW.watched_at IS NULL THEN timestamptz '1970-01-01 00:00:00+00' + make_interval(secs => o_rep + i)
             -- A kept date: the existing plays sit at date − 0…o_rep min, so step past them.
             ELSE NEW.watched_at - make_interval(mins => CASE WHEN v_date_changed THEN i - 1 ELSE o_rep + i END) END));
    END LOOP;
  ELSIF n_status = 'completed' AND o_status = 'completed' AND (n_rep < o_rep OR v_date_changed) THEN
    -- Fewer plays or a new date: Trakt keeps one row per play, so its plays
    -- are removed and the new number sent again at the date kept here.
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
  v_unknown boolean;
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
  v_unknown := n_at < timestamptz '1971-01-01 00:00:00+00';

  IF o_at IS NULL THEN
    -- Newly watched: every play it carries.
    FOR i IN 1 .. (n_rep + 1) LOOP
      PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at',
        CASE WHEN v_unknown THEN n_at + make_interval(secs => i - 1) ELSE n_at - make_interval(mins => i - 1) END));
    END LOOP;
    RETURN NULL;
  END IF;

  IF n_rep > o_rep THEN
    -- Extra plays only, at the new date when it changed, else at the kept date.
    FOR i IN 1 .. (n_rep - o_rep) LOOP
      PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at',
        CASE WHEN v_unknown THEN n_at + make_interval(secs => o_rep + i)
             -- A kept date: the existing plays sit at date − 0…o_rep min, so step past them.
             ELSE n_at - make_interval(mins => CASE WHEN n_at IS DISTINCT FROM o_at THEN i - 1 ELSE o_rep + i END) END));
    END LOOP;
  ELSIF n_rep < o_rep OR n_at IS DISTINCT FROM o_at THEN
    -- Fewer plays or a new date: resend this episode's plays at the kept date.
    PERFORM public.trakt_enqueue(v_user, 'history_remove', v_key, v_base);
    FOR i IN 1 .. (n_rep + 1) LOOP
      PERFORM public.trakt_enqueue(v_user, 'history_add', v_key, v_base || jsonb_build_object('watched_at',
        CASE WHEN v_unknown THEN n_at + make_interval(secs => i - 1) ELSE n_at - make_interval(mins => i - 1) END));
    END LOOP;
  END IF;
  RETURN NULL;
END;
$$;
