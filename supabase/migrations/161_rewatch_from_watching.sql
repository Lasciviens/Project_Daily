-- ─────────────────────────────────────────────────────────────────────────────
-- 161 · Watching = rewatching
--
-- Owner (Dev Request "General", 16.10.2026, point 5): "Rewatch do not work as
-- same as watching … What can we do to prevent data loss and correct
-- behavior"; answer 18.10.2026: "Watching = rewatching".
--
-- Before: a rewatch round (149) started only through the app's "Watch again"
-- (status watching + rewatch_round in one write). A finished show put on
-- Watching any other way — the status pills, the assistant, or a show already
-- on Watching when 149 shipped — had no round, so its next episode read "All
-- caught up" and the episodes being rewatched counted nowhere.
--
-- 1. media_tmdb_known / media_aired_episodes: every aired regular episode by
--    TMDB's data on tv_series (149's rule, now in one place;
--    media_rewatch_finished reads it too, unchanged in what it answers).
-- 2. media_rewatch_plan(kind, entry) → (round, started_at): where a new round
--    starts. A show whose first aired episode was watched again after the
--    latest watch of its last aired episode has begun a new pass at that
--    watch: the round starts there, so what was rewatched since counts.
--    Otherwise now. The round = one more than the fewest watches an aired
--    regular episode had before the start (never under 2); without TMDB data,
--    one more than the fewest watches of the regular episodes watched (the
--    app's own rule, rewatchStartRound). A movie: now, its watches + 1.
-- 3. media_rewatch_guard: Completed → Watching starts that round by itself,
--    from any writer but the Trakt sync (which decides statuses itself) — a
--    show only while every aired regular episode has a watch, so a show back
--    on Watching because a new season aired is plain watching, never a
--    rewatch; without TMDB data a show never guesses.
-- 4. app_start_rewatch(kind, entry): the app's Watch again and Daily's
--    "Start rewatch" — Watching + the planned round in one write; it answers
--    the round, where it starts and whether that was picked up from a watch.
--
-- No watch is written, moved or removed here: only rewatch_round and
-- rewatch_started_at change, on rows that are audited (Undo this save puts
-- them back). Re-runnable: CREATE OR REPLACE only, no table or column.
-- ─────────────────────────────────────────────────────────────────────────────

-- ── 1. Aired regular episodes, by TMDB's data ───────────────────────────────
CREATE OR REPLACE FUNCTION public.media_tmdb_known(p_series uuid)
RETURNS boolean
LANGUAGE sql STABLE SET search_path = public AS $$
  SELECT coalesce((
    SELECT nullif(metadata_json -> 'last_episode_to_air' ->> 'season_number', '') IS NOT NULL
       AND nullif(metadata_json -> 'last_episode_to_air' ->> 'episode_number', '') IS NOT NULL
       AND jsonb_typeof(metadata_json -> 'seasons') = 'array'
      FROM public.tv_series WHERE id = p_series), false)
$$;

CREATE OR REPLACE FUNCTION public.media_aired_episodes(p_series uuid)
RETURNS TABLE (season_number integer, episode_number integer)
LANGUAGE sql STABLE SET search_path = public AS $$
  WITH t AS (
    SELECT metadata_json AS meta,
           nullif(metadata_json -> 'last_episode_to_air' ->> 'season_number', '')::integer AS ls,
           nullif(metadata_json -> 'last_episode_to_air' ->> 'episode_number', '')::integer AS le
      FROM public.tv_series
     WHERE id = p_series AND jsonb_typeof(metadata_json -> 'seasons') = 'array'
  )
  SELECT (s ->> 'season_number')::integer, ep
    FROM t
   CROSS JOIN LATERAL jsonb_array_elements(t.meta -> 'seasons') s
   CROSS JOIN LATERAL generate_series(1, CASE WHEN (s ->> 'season_number')::integer = t.ls
                                              THEN least(coalesce((s ->> 'episode_count')::integer, 0), t.le)
                                              ELSE coalesce((s ->> 'episode_count')::integer, 0) END) ep
   WHERE t.ls IS NOT NULL AND t.le IS NOT NULL
     AND (s ->> 'season_number')::integer BETWEEN 1 AND t.ls
$$;

-- 149's answer, with its aired-episode set read from the function above.
CREATE OR REPLACE FUNCTION public.media_rewatch_finished(p_kind text, p_entry uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  e record;
BEGIN
  IF p_kind = 'movie' THEN
    SELECT id, user_id, rewatch_started_at INTO e FROM public.user_movie_entries WHERE id = p_entry;
    IF e.rewatch_started_at IS NULL THEN RETURN false; END IF;
    RETURN EXISTS (SELECT 1 FROM public.media_watches w WHERE w.movie_entry_id = e.id
      AND (w.watched_at >= e.rewatch_started_at OR (w.source = 'app' AND w.created_at >= e.rewatch_started_at)));
  END IF;

  SELECT id, user_id, tv_series_id, rewatch_started_at INTO e FROM public.user_tv_entries WHERE id = p_entry;
  IF e.rewatch_started_at IS NULL THEN RETURN false; END IF;
  IF public.media_tmdb_known(e.tv_series_id) THEN
    RETURN EXISTS (SELECT 1 FROM public.media_aired_episodes(e.tv_series_id))
      AND NOT EXISTS (
        SELECT 1 FROM public.media_aired_episodes(e.tv_series_id) a
         WHERE NOT EXISTS (SELECT 1 FROM public.media_watches w
                            WHERE w.user_id = e.user_id AND w.tv_series_id = e.tv_series_id AND w.kind = 'episode'
                              AND w.season_number = a.season_number AND w.episode_number = a.episode_number
                              AND (w.watched_at >= e.rewatch_started_at OR (w.source = 'app' AND w.created_at >= e.rewatch_started_at))));
  END IF;
  -- No TMDB data: every regular episode watched before is watched again.
  RETURN EXISTS (SELECT 1 FROM public.user_tv_episodes x WHERE x.tv_entry_id = e.id AND x.season_number > 0 AND x.watched_at IS NOT NULL)
    AND NOT EXISTS (
      SELECT 1 FROM public.user_tv_episodes x
       WHERE x.tv_entry_id = e.id AND x.season_number > 0 AND x.watched_at IS NOT NULL
         AND NOT EXISTS (SELECT 1 FROM public.media_watches w WHERE w.episode_id = x.id
                           AND (w.watched_at >= e.rewatch_started_at OR (w.source = 'app' AND w.created_at >= e.rewatch_started_at))));
END;
$$;

-- Every aired regular episode of a show has a watch (TMDB's data only: without
-- it a show never counts as finished — no guessing).
CREATE OR REPLACE FUNCTION public.media_all_aired_watched(p_entry uuid)
RETURNS boolean
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  e record;
BEGIN
  SELECT id, user_id, tv_series_id INTO e FROM public.user_tv_entries WHERE id = p_entry;
  IF e.id IS NULL OR NOT public.media_tmdb_known(e.tv_series_id) THEN RETURN false; END IF;
  RETURN EXISTS (SELECT 1 FROM public.media_aired_episodes(e.tv_series_id))
    AND NOT EXISTS (
      SELECT 1 FROM public.media_aired_episodes(e.tv_series_id) a
       WHERE NOT EXISTS (SELECT 1 FROM public.media_watches w
                          WHERE w.user_id = e.user_id AND w.tv_series_id = e.tv_series_id AND w.kind = 'episode'
                            AND w.season_number = a.season_number AND w.episode_number = a.episode_number));
END;
$$;

-- ── 2. Where a new round starts, and its number ─────────────────────────────
CREATE OR REPLACE FUNCTION public.media_rewatch_plan(p_kind text, p_entry uuid, OUT round integer, OUT started_at timestamptz)
LANGUAGE plpgsql STABLE SET search_path = public AS $$
DECLARE
  e       record;
  v_now   timestamptz := date_trunc('second', now());
  v_fs    integer; v_fe integer;   -- the first aired regular episode
  v_ls    integer; v_le integer;   -- the last aired regular episode
  v_first timestamptz;
  v_last  timestamptz;
BEGIN
  started_at := v_now;
  IF p_kind = 'movie' THEN
    round := greatest(2, (SELECT count(*) FROM public.media_watches w WHERE w.movie_entry_id = p_entry)::integer + 1);
    RETURN;
  END IF;

  SELECT id, user_id, tv_series_id INTO e FROM public.user_tv_entries WHERE id = p_entry;
  IF e.id IS NULL THEN round := 2; RETURN; END IF;

  IF public.media_tmdb_known(e.tv_series_id) AND EXISTS (SELECT 1 FROM public.media_aired_episodes(e.tv_series_id)) THEN
    SELECT a.season_number, a.episode_number INTO v_fs, v_fe FROM public.media_aired_episodes(e.tv_series_id) a ORDER BY 1, 2 LIMIT 1;
    SELECT a.season_number, a.episode_number INTO v_ls, v_le FROM public.media_aired_episodes(e.tv_series_id) a ORDER BY 1 DESC, 2 DESC LIMIT 1;
    -- Latest known dates (the epoch = an unknown date, which says nothing about order).
    SELECT max(w.watched_at) INTO v_first FROM public.media_watches w
     WHERE w.user_id = e.user_id AND w.tv_series_id = e.tv_series_id AND w.kind = 'episode'
       AND w.season_number = v_fs AND w.episode_number = v_fe AND w.watched_at > timestamptz 'epoch';
    SELECT max(w.watched_at) INTO v_last FROM public.media_watches w
     WHERE w.user_id = e.user_id AND w.tv_series_id = e.tv_series_id AND w.kind = 'episode'
       AND w.season_number = v_ls AND w.episode_number = v_le AND w.watched_at > timestamptz 'epoch';
    -- The first episode watched again after the last one: a new pass began then.
    IF (v_fs, v_fe) IS DISTINCT FROM (v_ls, v_le) AND v_first > v_last AND v_first <= v_now THEN
      started_at := date_trunc('second', v_first);
    END IF;
    SELECT 1 + min(c) INTO round FROM (
      SELECT (SELECT count(*) FROM public.media_watches w
               WHERE w.user_id = e.user_id AND w.tv_series_id = e.tv_series_id AND w.kind = 'episode'
                 AND w.season_number = a.season_number AND w.episode_number = a.episode_number
                 AND NOT (w.watched_at >= started_at OR (w.source = 'app' AND w.created_at >= started_at)))::integer AS c
        FROM public.media_aired_episodes(e.tv_series_id) a) x;
  ELSE
    -- No TMDB data: one more than the fewest watches of the regular episodes watched.
    SELECT 1 + min(1 + x.repeat_count) INTO round FROM public.user_tv_episodes x
     WHERE x.tv_entry_id = e.id AND x.season_number > 0 AND x.watched_at IS NOT NULL;
  END IF;
  round := greatest(2, coalesce(round, 2));
END;
$$;

-- ── 3. The guard: Completed → Watching is a rewatch ─────────────────────────
CREATE OR REPLACE FUNCTION public.media_rewatch_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_movie boolean := TG_TABLE_NAME = 'user_movie_entries';
  v_plan  record;
BEGIN
  IF TG_OP = 'UPDATE' AND OLD.status = 'completed' AND NEW.status = 'watching' AND NEW.rewatch_round IS NULL
     AND NOT public.trakt_sync_writing()
     AND (v_movie OR public.media_all_aired_watched(NEW.id)) THEN
    SELECT * INTO v_plan FROM public.media_rewatch_plan(CASE WHEN v_movie THEN 'movie' ELSE 'tv' END, NEW.id);
    NEW.rewatch_round := v_plan.round;
    NEW.rewatch_started_at := v_plan.started_at;
    RETURN NEW;
  END IF;
  -- 149's rule.
  IF NEW.status NOT IN ('watching', 'paused') OR NEW.rewatch_round IS NULL THEN
    NEW.rewatch_round := NULL;
    NEW.rewatch_started_at := NULL;
  ELSIF NEW.rewatch_started_at IS NULL
     OR (TG_OP = 'UPDATE' AND OLD.rewatch_round IS DISTINCT FROM NEW.rewatch_round AND NEW.rewatch_started_at IS NOT DISTINCT FROM OLD.rewatch_started_at) THEN
    -- A new round (from any writer) starts now (to the second, like watches).
    NEW.rewatch_started_at := date_trunc('second', now());
  END IF;
  RETURN NEW;
END;
$$;

-- ── 4. The app's door: start a round now ────────────────────────────────────
-- Invoker rights: row level security keeps it to the caller's own titles.
CREATE OR REPLACE FUNCTION public.app_start_rewatch(p_kind text, p_entry uuid)
RETURNS jsonb
LANGUAGE plpgsql SET search_path = public AS $$
DECLARE
  v_plan record;
  v_n    integer;
BEGIN
  IF p_kind NOT IN ('movie', 'tv') THEN RAISE EXCEPTION 'app_start_rewatch: kind must be movie or tv' USING ERRCODE = '22023'; END IF;
  SELECT * INTO v_plan FROM public.media_rewatch_plan(p_kind, p_entry);
  IF p_kind = 'movie' THEN
    UPDATE public.user_movie_entries
       SET status = 'watching', rewatch_round = v_plan.round, rewatch_started_at = v_plan.started_at
     WHERE id = p_entry;
  ELSE
    UPDATE public.user_tv_entries
       SET status = 'watching', rewatch_round = v_plan.round, rewatch_started_at = v_plan.started_at
     WHERE id = p_entry;
  END IF;
  GET DIAGNOSTICS v_n = ROW_COUNT;
  IF v_n = 0 THEN RAISE EXCEPTION 'app_start_rewatch: no such title' USING ERRCODE = 'P0002'; END IF;
  RETURN jsonb_build_object(
    'round', v_plan.round,
    'started_at', v_plan.started_at,
    'picked_up', v_plan.started_at < date_trunc('second', now()));
END;
$$;

GRANT EXECUTE ON FUNCTION public.media_tmdb_known(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.media_aired_episodes(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.media_all_aired_watched(uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.media_rewatch_plan(text, uuid) TO authenticated;
GRANT EXECUTE ON FUNCTION public.app_start_rewatch(text, uuid) TO authenticated;
REVOKE EXECUTE ON FUNCTION public.app_start_rewatch(text, uuid) FROM anon;
