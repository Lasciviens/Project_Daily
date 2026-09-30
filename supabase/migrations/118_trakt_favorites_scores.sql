-- 118 — Trakt phase 5 (favorites) + phase 6 (more scores). docs/trakt/PLAN.md.
-- Additive; updates no existing row. Safe to re-run.
--
-- 1. More MDBList scores on the catalogue rows 116 already gave rt_critics /
--    rt_audience / metacritic: IMDb (/10), Letterboxd (/5) and the Rotten
--    Tomatoes page link. Written by trakt-api (service role) only.
-- 2. Favorites, app → Trakt: a change to is_favorite queues favorite_add /
--    favorite_remove in trakt_outbox (drained by trakt-api's sync). The key is
--    `fav:<type>:<tmdb>` so a waiting favorite never holds back the rest of the
--    title's mirror. Writes made by the sync itself are skipped (117's
--    trakt_sync_writing()), and nothing is queued while Trakt is disconnected.

ALTER TABLE public.movies
  ADD COLUMN IF NOT EXISTS imdb_rating       numeric(3,1),
  ADD COLUMN IF NOT EXISTS letterboxd_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS rt_url            text;
ALTER TABLE public.tv_series
  ADD COLUMN IF NOT EXISTS imdb_rating       numeric(3,1),
  ADD COLUMN IF NOT EXISTS letterboxd_rating numeric(2,1),
  ADD COLUMN IF NOT EXISTS rt_url            text;

CREATE OR REPLACE FUNCTION public.trakt_outbox_favorite() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_type text := CASE WHEN TG_TABLE_NAME = 'user_movie_entries' THEN 'movie' ELSE 'show' END;
  o_fav boolean := CASE WHEN TG_OP = 'INSERT' THEN false ELSE coalesce(OLD.is_favorite, false) END;
  n_fav boolean := CASE WHEN TG_OP = 'DELETE' THEN false ELSE coalesce(NEW.is_favorite, false) END;
  v_tmdb integer;
BEGIN
  IF o_fav = n_fav THEN RETURN NULL; END IF;
  IF public.trakt_sync_writing() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trakt_tokens WHERE user_id = v_user) THEN RETURN NULL; END IF;
  IF v_type = 'movie' THEN
    SELECT tmdb_id INTO v_tmdb FROM public.movies
     WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.movie_id ELSE NEW.movie_id END;
  ELSE
    SELECT tmdb_id INTO v_tmdb FROM public.tv_series
     WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.tv_series_id ELSE NEW.tv_series_id END;
  END IF;
  IF v_tmdb IS NULL THEN RETURN NULL; END IF;
  PERFORM public.trakt_enqueue(v_user, CASE WHEN n_fav THEN 'favorite_add' ELSE 'favorite_remove' END,
    'fav:' || v_type || ':' || v_tmdb, jsonb_build_object('type', v_type, 'tmdb', v_tmdb));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trakt_outbox_favorite ON public.user_movie_entries;
CREATE TRIGGER trg_trakt_outbox_favorite AFTER INSERT OR UPDATE OF is_favorite OR DELETE
  ON public.user_movie_entries FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_favorite();
DROP TRIGGER IF EXISTS trg_trakt_outbox_favorite ON public.user_tv_entries;
CREATE TRIGGER trg_trakt_outbox_favorite AFTER INSERT OR UPDATE OF is_favorite OR DELETE
  ON public.user_tv_entries FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_favorite();
