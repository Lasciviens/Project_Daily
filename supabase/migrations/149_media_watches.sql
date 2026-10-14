-- ═══════════════════════════════════════════════════════════════════════════
-- 149 — Every watch keeps its own date (media_watches), and rewatching.
--
-- Why (owner, 14.10.2026): the app kept ONE date per watched episode/movie
-- (user_tv_episodes.watched_at / user_movie_entries.watched_at = the latest
-- watch, repeat_count = plays − 1) while Trakt keeps every play with its own
-- date. A date change was sent as "remove ALL plays of the item + add every
-- play at the new date" (the 120/132 outbox triggers), so re-dating 73 Game
-- of Thrones episodes with Spread wiped their 2018 first-watch and 2026
-- third-watch dates on Trakt; "Watched again" moved the single date to the
-- newest watch, so the first-watch date was lost here too.
--
-- 1. media_watches: one row per watch of an episode or a movie, with its
--    own watched_at (an unknown date stays the epoch for an episode and NULL
--    for a movie — the 117 convention), trakt_history_id (Trakt's id of that
--    one play, unique per user) and source ('app' | 'trakt' | 'backfill' — a
--    placeholder the Trakt pull may replace with the real play). An episode
--    watch names its show + season + episode, so a removed episode row comes
--    back when the watch does (Undo).
-- 2. The old columns stay as a CACHE, kept by trigger from the watches:
--    watched_at = the latest watch (the epoch / NULL when unknown),
--    repeat_count = watches − 1. Every reader keeps working. A watch for an
--    episode the app has no row for creates that row; removing the last
--    watch sets it to not watched (watched_at NULL; the row stays, so an
--    Undo puts the watch back on it). A movie's first watch makes a
--    Wishlist movie Completed, removing its last watch makes a Completed one
--    Wishlist (the sync decides statuses itself, so neither applies to it).
-- 3. Old writers keep working (the assistant's db_* tools, the Trakt sync's
--    summary writes, SQL): a write to the cache columns is translated into
--    watches at the end of the transaction (deferred constraint triggers —
--    by then an Undo has put its own watch rows back, so nothing doubles):
--    a watched row with no watches gets 1 + repeat_count of them; more plays
--    add watches at the written date; fewer plays remove the most recently
--    added ones (never the latest, which holds the kept date); a new date
--    moves the latest watch; not watched (a Wishlist
--    movie, an episode's watched_at set NULL) removes them all.
-- 4. Trakt outbox: a new watch → history_add at its own date; a removed watch
--    → history_remove_play (ONLY that play, by trakt_history_id — trakt-api
--    looks the id up when it is not known yet); a new date on one watch =
--    remove that play + add the new one. The whole item's history_remove is
--    queued only when it is unmarked entirely (the episode row deleted or
--    set NULL, the movie moved to Wishlist or deleted). Sync writes
--    (x-trakt-sync) still queue nothing.
-- 5. Rewatching (owner, 14.10.2026): rewatch_round on user_tv_entries /
--    user_movie_entries = the round being watched (2 = the second time
--    through; NULL = not a rewatch). A rewatching title stays Watching; the
--    watch that brings every watched regular episode (a movie: its watches)
--    up to the round makes it Completed again. Leaving Watching/Paused ends
--    the round. Trakt's own reset (POST /shows/{id}/progress/watched/reset)
--    is VIP-only and only changes Trakt's progress view, so it is not used.
-- 6. Backfill: one watch per existing play, all at the kept date (the only
--    date the app had), source 'backfill'; the next Trakt pull replaces them
--    with the real per-play history (trakt_sync_state.history_synced_at is
--    NULL → a full history read). Queued nothing for Trakt.
--
-- trg_audit on media_watches (user-authored). Re-runnable: IF NOT EXISTS,
-- CREATE OR REPLACE, DROP TRIGGER IF EXISTS, and the backfill only fills
-- rows that have no watches yet.

-- ── 1. The table ────────────────────────────────────────────────────────────
CREATE TABLE IF NOT EXISTS public.media_watches (
  id               uuid PRIMARY KEY DEFAULT gen_random_uuid(),
  user_id          uuid NOT NULL DEFAULT auth.uid() REFERENCES auth.users(id) ON DELETE CASCADE,
  kind             text NOT NULL CHECK (kind IN ('movie', 'episode')),
  movie_entry_id   uuid REFERENCES public.user_movie_entries(id) ON DELETE CASCADE,
  episode_id       uuid REFERENCES public.user_tv_episodes(id) ON DELETE CASCADE,
  tv_series_id     uuid REFERENCES public.tv_series(id) ON DELETE CASCADE,
  season_number    integer CHECK (season_number >= 0),
  episode_number   integer CHECK (episode_number >= 0),
  watched_at       timestamptz,
  trakt_history_id bigint,
  source           text NOT NULL DEFAULT 'app' CHECK (source IN ('app', 'trakt', 'backfill')),
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now(),
  CONSTRAINT media_watches_shape CHECK (
    (kind = 'movie' AND movie_entry_id IS NOT NULL AND episode_id IS NULL AND tv_series_id IS NULL
      AND season_number IS NULL AND episode_number IS NULL)
    OR (kind = 'episode' AND movie_entry_id IS NULL AND episode_id IS NOT NULL AND tv_series_id IS NOT NULL
      AND season_number IS NOT NULL AND episode_number IS NOT NULL AND watched_at IS NOT NULL))
);
ALTER TABLE public.media_watches ENABLE ROW LEVEL SECURITY;
DO $$ BEGIN
  IF NOT EXISTS (SELECT 1 FROM pg_policies WHERE schemaname = 'public' AND tablename = 'media_watches' AND policyname = 'Users manage own media watches') THEN
    CREATE POLICY "Users manage own media watches" ON public.media_watches FOR ALL
      USING ((select auth.uid()) = user_id) WITH CHECK ((select auth.uid()) = user_id);
  END IF;
END $$;
GRANT SELECT, INSERT, UPDATE, DELETE ON public.media_watches TO authenticated;

CREATE UNIQUE INDEX IF NOT EXISTS media_watches_trakt_history_key ON public.media_watches (user_id, trakt_history_id) WHERE trakt_history_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_watches_user_watched_idx ON public.media_watches (user_id, watched_at DESC);
CREATE INDEX IF NOT EXISTS media_watches_episode_idx ON public.media_watches (episode_id) WHERE episode_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_watches_movie_idx ON public.media_watches (movie_entry_id) WHERE movie_entry_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS media_watches_series_idx ON public.media_watches (user_id, tv_series_id, season_number, episode_number) WHERE kind = 'episode';

-- ── Rewatch rounds + the history pull's stamp ───────────────────────────────
ALTER TABLE public.user_tv_entries ADD COLUMN IF NOT EXISTS rewatch_round integer CHECK (rewatch_round IS NULL OR rewatch_round >= 2);
ALTER TABLE public.user_movie_entries ADD COLUMN IF NOT EXISTS rewatch_round integer CHECK (rewatch_round IS NULL OR rewatch_round >= 2);
-- NULL = the next sync reads the whole Trakt history (first run after 149, after a reconnect).
ALTER TABLE public.trakt_sync_state ADD COLUMN IF NOT EXISTS history_synced_at timestamptz;

-- ── 6. Backfill (before the triggers below exist on a first run; marked as a
--    sync write so a re-run queues nothing for Trakt either) ────────────────
SELECT set_config('app.trakt_sync', 'on', true);

INSERT INTO public.media_watches (user_id, kind, episode_id, tv_series_id, season_number, episode_number, watched_at, source)
SELECT e.user_id, 'episode', e.id, e.tv_series_id, e.season_number, e.episode_number, date_trunc('second', e.watched_at), 'backfill'
  FROM public.user_tv_episodes e
 CROSS JOIN LATERAL generate_series(1, 1 + greatest(coalesce(e.repeat_count, 0), 0)) g
 WHERE e.watched_at IS NOT NULL
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = e.user_id)
   AND NOT EXISTS (SELECT 1 FROM public.media_watches w WHERE w.episode_id = e.id);

-- Movies: what counted as watched before — Completed (a NULL date = unknown),
-- or Watching/Dropped with a watched date (Media's stats counted those too).
INSERT INTO public.media_watches (user_id, kind, movie_entry_id, watched_at, source)
SELECT m.user_id, 'movie', m.id, date_trunc('second', m.watched_at), 'backfill'
  FROM public.user_movie_entries m
 CROSS JOIN LATERAL generate_series(1, 1 + greatest(coalesce(m.repeat_count, 0), 0)) g
 WHERE (m.status = 'completed' OR (m.status IN ('watching', 'dropped') AND m.watched_at IS NOT NULL))
   AND EXISTS (SELECT 1 FROM auth.users u WHERE u.id = m.user_id)
   AND NOT EXISTS (SELECT 1 FROM public.media_watches w WHERE w.movie_entry_id = m.id);

SELECT set_config('app.trakt_sync', '', true);

-- ── 2. Before a watch is written: its shape, its parent, its Trakt link ─────
-- A watch never moves to another item; only the Trakt sync may set
-- trakt_history_id / source (any other writer's new date drops the link — the
-- old play is removed on Trakt and the new one added).
CREATE OR REPLACE FUNCTION public.media_watch_before() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sync  boolean := public.trakt_sync_writing();
  v_entry uuid;
  v_ep    public.user_tv_episodes%ROWTYPE;
  v_owner uuid;
  v_prev  text;
BEGIN
  NEW.watched_at := date_trunc('second', NEW.watched_at);
  IF TG_OP = 'UPDATE' THEN
    NEW.user_id := OLD.user_id; NEW.kind := OLD.kind; NEW.movie_entry_id := OLD.movie_entry_id;
    NEW.episode_id := OLD.episode_id; NEW.tv_series_id := OLD.tv_series_id;
    NEW.season_number := OLD.season_number; NEW.episode_number := OLD.episode_number;
    NEW.created_at := OLD.created_at;
    IF NOT v_sync THEN
      IF NEW.watched_at IS DISTINCT FROM OLD.watched_at THEN
        NEW.trakt_history_id := NULL; NEW.source := 'app';
      ELSE
        NEW.trakt_history_id := OLD.trakt_history_id; NEW.source := OLD.source;
      END IF;
    END IF;
    RETURN NEW;
  END IF;

  IF NOT v_sync THEN NEW.trakt_history_id := NULL; NEW.source := 'app'; END IF;

  IF NEW.kind = 'movie' THEN
    SELECT user_id INTO v_owner FROM public.user_movie_entries WHERE id = NEW.movie_entry_id;
    IF v_owner IS NOT NULL AND v_owner <> NEW.user_id THEN
      RAISE EXCEPTION 'media_watches: that movie entry belongs to someone else' USING errcode = '42501';
    END IF;
    RETURN NEW;
  END IF;

  -- Episode: the row named by episode_id (a row put back: Undo), else the one
  -- for show + season + episode (a new watch).
  IF NEW.episode_id IS NOT NULL THEN
    SELECT * INTO v_ep FROM public.user_tv_episodes WHERE id = NEW.episode_id AND user_id = NEW.user_id;
    -- Not (yet) there: an undo that puts the episode row back in a later
    -- step retries on this error (150); never a second row for the episode.
    IF v_ep.id IS NULL THEN
      RAISE EXCEPTION 'media_watches: its episode row is not there' USING errcode = '23503';
    END IF;
  ELSE
    IF NEW.tv_series_id IS NULL OR NEW.season_number IS NULL OR NEW.episode_number IS NULL THEN
      RAISE EXCEPTION 'media_watches: an episode watch needs tv_series_id, season_number and episode_number' USING errcode = '23502';
    END IF;
    SELECT * INTO v_ep FROM public.user_tv_episodes
     WHERE user_id = NEW.user_id AND tv_series_id = NEW.tv_series_id
       AND season_number = NEW.season_number AND episode_number = NEW.episode_number;
  END IF;
  IF v_ep.id IS NULL THEN
    -- The episode has no row yet (a first watch): create it under the
    -- show's library entry. The cache trigger fills its date and plays right
    -- after this insert.
    SELECT id INTO v_entry FROM public.user_tv_entries WHERE user_id = NEW.user_id AND tv_series_id = NEW.tv_series_id;
    IF v_entry IS NULL THEN
      RAISE EXCEPTION 'media_watches: the show is not in the library' USING errcode = '23503';
    END IF;
    v_prev := current_setting('app.media_watch_cache', true);
    PERFORM set_config('app.media_watch_cache', 'on', true);
    INSERT INTO public.user_tv_episodes (user_id, tv_entry_id, tv_series_id, season_number, episode_number, watched_at, repeat_count)
    VALUES (NEW.user_id, v_entry, NEW.tv_series_id, NEW.season_number, NEW.episode_number, NEW.watched_at, 0)
    RETURNING * INTO v_ep;
    PERFORM set_config('app.media_watch_cache', coalesce(v_prev, ''), true);
  END IF;
  NEW.episode_id := v_ep.id;
  NEW.tv_series_id := v_ep.tv_series_id;
  NEW.season_number := v_ep.season_number;
  NEW.episode_number := v_ep.episode_number;
  RETURN NEW;
END;
$$;

DROP TRIGGER IF EXISTS trg_media_watch_before ON public.media_watches;
CREATE TRIGGER trg_media_watch_before BEFORE INSERT OR UPDATE ON public.media_watches
  FOR EACH ROW EXECUTE FUNCTION public.media_watch_before();

-- ── 2. After a watch changes: the cache columns follow ──────────────────────
-- Runs with app.media_watch_cache = 'on', so the translation below (3) is not
-- queued for its own writes. A rewatch round is finished by the watch that
-- brings every watched regular episode (a movie: its watches) up to it.
CREATE OR REPLACE FUNCTION public.media_watch_cache() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w        public.media_watches := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_sync   boolean := public.trakt_sync_writing();
  v_prev   text := current_setting('app.media_watch_cache', true);
  v_n      integer;
  v_latest timestamptz;
  v_entry  public.user_tv_entries%ROWTYPE;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.watched_at IS NOT DISTINCT FROM OLD.watched_at THEN RETURN NULL; END IF;
  PERFORM set_config('app.media_watch_cache', 'on', true);

  IF w.kind = 'episode' THEN
    SELECT count(*), max(watched_at) INTO v_n, v_latest FROM public.media_watches WHERE episode_id = w.episode_id;
    IF v_n = 0 THEN
      -- The last watch went: not watched. The row stays (watched_at NULL — what
      -- every reader takes as not watched), so an Undo puts its watch back on it.
      UPDATE public.user_tv_episodes SET watched_at = NULL, repeat_count = 0
       WHERE id = w.episode_id AND watched_at IS NOT NULL;
    ELSE
      UPDATE public.user_tv_episodes
         SET watched_at = v_latest, repeat_count = v_n - 1
       WHERE id = w.episode_id
         AND (date_trunc('second', watched_at) IS DISTINCT FROM v_latest OR repeat_count IS DISTINCT FROM v_n - 1);
    END IF;
    IF TG_OP = 'INSERT' THEN
      SELECT * INTO v_entry FROM public.user_tv_entries
       WHERE user_id = w.user_id AND tv_series_id = w.tv_series_id AND status = 'watching' AND rewatch_round IS NOT NULL;
      IF v_entry.id IS NOT NULL AND NOT EXISTS (
        SELECT 1 FROM public.user_tv_episodes e
         WHERE e.tv_entry_id = v_entry.id AND e.season_number > 0 AND e.watched_at IS NOT NULL
           AND coalesce(e.repeat_count, 0) + 1 < v_entry.rewatch_round
      ) THEN
        UPDATE public.user_tv_entries SET status = 'completed', rewatch_round = NULL WHERE id = v_entry.id;
      END IF;
    END IF;
  ELSE
    SELECT count(*), max(watched_at) INTO v_n, v_latest FROM public.media_watches WHERE movie_entry_id = w.movie_entry_id;
    UPDATE public.user_movie_entries m
       SET watched_at = v_latest,
           repeat_count = greatest(v_n - 1, 0),
           status = CASE
             WHEN v_sync THEN m.status
             WHEN v_n = 0 AND m.status = 'completed' THEN 'wishlist'
             WHEN v_n > 0 AND m.status IN ('wishlist', 'upcoming') THEN 'completed'
             WHEN TG_OP = 'INSERT' AND m.status = 'watching' AND m.rewatch_round IS NOT NULL AND v_n >= m.rewatch_round THEN 'completed'
             ELSE m.status END
     WHERE m.id = w.movie_entry_id
       AND (date_trunc('second', m.watched_at) IS DISTINCT FROM v_latest
         OR m.repeat_count IS DISTINCT FROM greatest(v_n - 1, 0)
         OR (NOT v_sync AND v_n = 0 AND m.status = 'completed')
         OR (NOT v_sync AND v_n > 0 AND m.status IN ('wishlist', 'upcoming'))
         OR (TG_OP = 'INSERT' AND m.status = 'watching' AND m.rewatch_round IS NOT NULL AND v_n >= m.rewatch_round));
  END IF;

  PERFORM set_config('app.media_watch_cache', coalesce(v_prev, ''), true);
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_media_watch_cache ON public.media_watches;
CREATE TRIGGER trg_media_watch_cache AFTER INSERT OR UPDATE OF watched_at OR DELETE ON public.media_watches
  FOR EACH ROW EXECUTE FUNCTION public.media_watch_cache();

-- ── 5. A rewatch round ends when the title leaves Watching (or Paused) ──────
CREATE OR REPLACE FUNCTION public.media_rewatch_guard() RETURNS trigger
LANGUAGE plpgsql SET search_path = public AS $$
BEGIN
  IF NEW.status NOT IN ('watching', 'paused') THEN NEW.rewatch_round := NULL; END IF;
  RETURN NEW;
END;
$$;
DROP TRIGGER IF EXISTS trg_media_rewatch_guard ON public.user_tv_entries;
CREATE TRIGGER trg_media_rewatch_guard BEFORE INSERT OR UPDATE OF status, rewatch_round ON public.user_tv_entries
  FOR EACH ROW EXECUTE FUNCTION public.media_rewatch_guard();
DROP TRIGGER IF EXISTS trg_media_rewatch_guard ON public.user_movie_entries;
CREATE TRIGGER trg_media_rewatch_guard BEFORE INSERT OR UPDATE OF status, rewatch_round ON public.user_movie_entries
  FOR EACH ROW EXECUTE FUNCTION public.media_rewatch_guard();

-- ── 3. Writes to the cache columns become watches (end of the transaction) ──
-- Deferred, so a restore (app_restore_rows) that puts back an entry AND its
-- watches in one transaction is seen whole; it then finds nothing to do.
-- Not queued for the cache trigger's own writes (app.media_watch_cache).
CREATE OR REPLACE FUNCTION public.media_watch_reconcile() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_sync   boolean := public.trakt_sync_writing();
  v_source text := CASE WHEN public.trakt_sync_writing() THEN 'backfill' ELSE 'app' END;
  v_prev   text;
  e        public.user_tv_episodes%ROWTYPE;
  m        public.user_movie_entries%ROWTYPE;
  v_user   uuid;
  v_kind   text;
  v_at     timestamptz;    -- the date the writer left in the cache column
  v_target integer;
  v_n      integer;
  v_latest timestamptz;
  v_moved  boolean;
  v_unknown boolean;
  v_keep   uuid;
BEGIN
  IF TG_TABLE_NAME = 'user_tv_episodes' THEN
    SELECT * INTO e FROM public.user_tv_episodes WHERE id = NEW.id;
    IF e.id IS NULL THEN RETURN NULL; END IF;
    v_kind := 'episode'; v_user := e.user_id; v_at := date_trunc('second', e.watched_at);
    SELECT count(*), max(watched_at) INTO v_n, v_latest FROM public.media_watches WHERE episode_id = e.id;
    IF e.watched_at IS NULL THEN
      -- Not watched: every watch goes (its whole-episode remove was queued by trakt_outbox_episode).
      IF v_n > 0 THEN
        v_prev := current_setting('app.media_watch_bulk', true);
        PERFORM set_config('app.media_watch_bulk', 'on', true);
        DELETE FROM public.media_watches WHERE episode_id = e.id;
        PERFORM set_config('app.media_watch_bulk', coalesce(v_prev, ''), true);
      END IF;
      RETURN NULL;
    END IF;
    v_target := 1 + greatest(coalesce(e.repeat_count, 0), 0);
  ELSE
    SELECT * INTO m FROM public.user_movie_entries WHERE id = NEW.id;
    IF m.id IS NULL THEN RETURN NULL; END IF;
    v_kind := 'movie'; v_user := m.user_id; v_at := date_trunc('second', m.watched_at);
    SELECT count(*), max(watched_at) INTO v_n, v_latest FROM public.media_watches WHERE movie_entry_id = m.id;
    IF m.status IN ('wishlist', 'upcoming') THEN
      -- Want to watch = no plays (the movie-wide remove was queued by trakt_outbox_movie).
      IF v_n > 0 THEN
        v_prev := current_setting('app.media_watch_bulk', true);
        PERFORM set_config('app.media_watch_bulk', 'on', true);
        DELETE FROM public.media_watches WHERE movie_entry_id = m.id;
        PERFORM set_config('app.media_watch_bulk', coalesce(v_prev, ''), true);
      END IF;
      RETURN NULL;
    END IF;
    -- Watching/Dropped without a watch and without a date: nothing was watched.
    IF v_n = 0 AND m.status <> 'completed' AND m.watched_at IS NULL THEN RETURN NULL; END IF;
    v_target := 1 + greatest(coalesce(m.repeat_count, 0), 0);
  END IF;

  IF v_n = v_target AND v_latest IS NOT DISTINCT FROM v_at THEN RETURN NULL; END IF;
  v_unknown := v_at IS NULL OR v_at < timestamptz '1971-01-01 00:00:00+00';
  -- The written date moved: new watches go there; else extras step back from it.
  v_moved := v_n > 0 AND v_latest IS DISTINCT FROM v_at;

  IF v_n < v_target THEN
    FOR i IN 1 .. (v_target - v_n) LOOP
      INSERT INTO public.media_watches (user_id, kind, movie_entry_id, episode_id, tv_series_id, season_number, episode_number, watched_at, source)
      VALUES (
        v_user, v_kind,
        CASE WHEN v_kind = 'movie' THEN m.id END,
        CASE WHEN v_kind = 'episode' THEN e.id END,
        CASE WHEN v_kind = 'episode' THEN e.tv_series_id END,
        CASE WHEN v_kind = 'episode' THEN e.season_number END,
        CASE WHEN v_kind = 'episode' THEN e.episode_number END,
        CASE
          WHEN v_at IS NULL THEN NULL
          WHEN v_unknown THEN v_at + make_interval(secs => CASE WHEN v_moved OR v_n = 0 THEN i - 1 ELSE v_n + i - 1 END)
          ELSE v_at - make_interval(mins => CASE WHEN v_moved OR v_n = 0 THEN i - 1 ELSE v_n + i - 1 END)
        END,
        v_source);
    END LOOP;
    RETURN NULL;
  END IF;

  -- The latest watch holds the date the writer saw (and may have changed).
  SELECT id INTO v_keep FROM public.media_watches
   WHERE (v_kind = 'episode' AND episode_id = e.id) OR (v_kind = 'movie' AND movie_entry_id = m.id)
   ORDER BY watched_at DESC NULLS LAST, created_at DESC, id DESC
   LIMIT 1;
  IF v_n > v_target THEN
    -- Fewer plays: the most recently added of the other watches go.
    DELETE FROM public.media_watches WHERE id IN (
      SELECT id FROM public.media_watches
       WHERE ((v_kind = 'episode' AND episode_id = e.id) OR (v_kind = 'movie' AND movie_entry_id = m.id)) AND id <> v_keep
       ORDER BY created_at DESC, watched_at DESC NULLS LAST, id DESC
       LIMIT v_n - v_target);
  END IF;
  IF v_latest IS DISTINCT FROM v_at THEN
    -- A new date: it is the latest watch's.
    UPDATE public.media_watches SET watched_at = v_at WHERE id = v_keep;
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_media_watch_reconcile ON public.user_tv_episodes;
CREATE CONSTRAINT TRIGGER trg_media_watch_reconcile AFTER INSERT OR UPDATE OF watched_at, repeat_count ON public.user_tv_episodes
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (coalesce(current_setting('app.media_watch_cache', true), '') <> 'on')
  EXECUTE FUNCTION public.media_watch_reconcile();
DROP TRIGGER IF EXISTS trg_media_watch_reconcile ON public.user_movie_entries;
CREATE CONSTRAINT TRIGGER trg_media_watch_reconcile AFTER INSERT OR UPDATE OF status, watched_at, repeat_count ON public.user_movie_entries
  DEFERRABLE INITIALLY DEFERRED FOR EACH ROW
  WHEN (coalesce(current_setting('app.media_watch_cache', true), '') <> 'on')
  EXECUTE FUNCTION public.media_watch_reconcile();

-- ── 4. Trakt outbox: one play at a time ─────────────────────────────────────
-- A watch removed with its parent (the episode row deleted or set to not
-- watched, a movie removed from the library) queues nothing here: the
-- parent's own trigger removed every play. An undo from Developer → Activity
-- (150) writes through these same triggers, so it too adds or removes single
-- plays — it never wipes an item's history for a date.
CREATE OR REPLACE FUNCTION public.trakt_outbox_watch() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  w      public.media_watches := CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
  v_tmdb integer;
  v_key  text;
  v_base jsonb;
BEGIN
  IF TG_OP = 'UPDATE' AND NEW.watched_at IS NOT DISTINCT FROM OLD.watched_at THEN RETURN NULL; END IF;
  IF public.trakt_sync_writing() THEN RETURN NULL; END IF;
  IF coalesce(current_setting('app.media_watch_bulk', true), '') = 'on' THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trakt_tokens WHERE user_id = w.user_id) THEN RETURN NULL; END IF;

  IF w.kind = 'movie' THEN
    SELECT mv.tmdb_id INTO v_tmdb FROM public.user_movie_entries me JOIN public.movies mv ON mv.id = me.movie_id
     WHERE me.id = w.movie_entry_id;
    IF v_tmdb IS NULL THEN RETURN NULL; END IF;
    v_key := 'movie:' || v_tmdb;
    v_base := jsonb_build_object('type', 'movie', 'tmdb', v_tmdb);
  ELSE
    -- Gone with its episode, or the episode is now not watched: the
    -- episode's own trigger removed every play.
    IF TG_OP = 'DELETE' AND NOT EXISTS (SELECT 1 FROM public.user_tv_episodes WHERE id = OLD.episode_id AND watched_at IS NOT NULL) THEN RETURN NULL; END IF;
    SELECT tmdb_id INTO v_tmdb FROM public.tv_series WHERE id = w.tv_series_id;
    IF v_tmdb IS NULL THEN RETURN NULL; END IF;
    v_key := 'ep:' || v_tmdb || ':' || w.season_number || ':' || w.episode_number;
    v_base := jsonb_build_object('type', 'episode', 'tmdb', v_tmdb, 'season', w.season_number, 'episode', w.episode_number);
  END IF;

  IF TG_OP IN ('UPDATE', 'DELETE') THEN
    -- Held for an hour: the trakt-api deployed before this migration deletes
    -- an op it doesn't know without sending it, and the deploy runs migrations
    -- first. The new trakt-api sends a never-tried single-play remove at once
    -- regardless of next_retry_at, so the hold only hides it from the old one.
    INSERT INTO public.trakt_outbox (user_id, op, item_key, payload, next_retry_at)
    SELECT w.user_id, 'history_remove_play', v_key, v_base || jsonb_build_object(
      'watch_id', OLD.id, 'history_id', OLD.trakt_history_id, 'watched_at', OLD.watched_at),
      now() + interval '1 hour'
    WHERE EXISTS (SELECT 1 FROM auth.users WHERE id = w.user_id);
  END IF;
  IF TG_OP IN ('INSERT', 'UPDATE') THEN
    PERFORM public.trakt_enqueue(w.user_id, 'history_add', v_key, v_base || jsonb_build_object(
      'watch_id', NEW.id, 'watched_at', NEW.watched_at));
  END IF;
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trakt_outbox_watch ON public.media_watches;
CREATE TRIGGER trg_trakt_outbox_watch AFTER INSERT OR UPDATE OF watched_at OR DELETE ON public.media_watches
  FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_watch();

-- Episodes: plays are the watches' now. The row itself only says "watched";
-- deleting it, or setting it to not watched, removes every play on Trakt.
CREATE OR REPLACE FUNCTION public.trakt_outbox_episode() RETURNS trigger
LANGUAGE plpgsql SECURITY DEFINER SET search_path = public AS $$
DECLARE
  v_user uuid := CASE WHEN TG_OP = 'DELETE' THEN OLD.user_id ELSE NEW.user_id END;
  v_tmdb integer;
BEGIN
  IF TG_OP = 'INSERT' THEN RETURN NULL; END IF;
  IF OLD.watched_at IS NULL THEN RETURN NULL; END IF;
  IF TG_OP = 'UPDATE' AND NEW.watched_at IS NOT NULL THEN RETURN NULL; END IF;
  IF public.trakt_sync_writing() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trakt_tokens WHERE user_id = v_user) THEN RETURN NULL; END IF;
  SELECT tmdb_id INTO v_tmdb FROM public.tv_series WHERE id = OLD.tv_series_id;
  IF v_tmdb IS NULL THEN RETURN NULL; END IF;
  PERFORM public.trakt_enqueue(v_user, 'history_remove',
    'ep:' || v_tmdb || ':' || OLD.season_number || ':' || OLD.episode_number,
    jsonb_build_object('type', 'episode', 'tmdb', v_tmdb, 'season', OLD.season_number, 'episode', OLD.episode_number));
  RETURN NULL;
END;
$$;

DROP TRIGGER IF EXISTS trg_trakt_outbox_episode ON public.user_tv_episodes;
CREATE TRIGGER trg_trakt_outbox_episode AFTER UPDATE OF watched_at OR DELETE
  ON public.user_tv_episodes FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_episode();

-- Movies: watchlist and rating as before; plays are the watches' now. Only
-- Wishlist/Upcoming (or removing the title) removes every play on Trakt.
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
  v_base jsonb;
BEGIN
  IF public.trakt_sync_writing() THEN RETURN NULL; END IF;
  IF NOT EXISTS (SELECT 1 FROM public.trakt_tokens WHERE user_id = v_user) THEN RETURN NULL; END IF;
  SELECT tmdb_id INTO v_tmdb FROM public.movies
   WHERE id = CASE WHEN TG_OP = 'DELETE' THEN OLD.movie_id ELSE NEW.movie_id END;
  IF v_tmdb IS NULL THEN RETURN NULL; END IF;
  v_key := 'movie:' || v_tmdb;
  v_base := jsonb_build_object('type', 'movie', 'tmdb', v_tmdb);

  IF TG_OP = 'DELETE'
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

DROP TRIGGER IF EXISTS trg_trakt_outbox_movie ON public.user_movie_entries;
CREATE TRIGGER trg_trakt_outbox_movie AFTER INSERT OR UPDATE OF status, rating OR DELETE
  ON public.user_movie_entries FOR EACH ROW EXECUTE FUNCTION public.trakt_outbox_movie();

-- ── updated_at, audit ───────────────────────────────────────────────────────
DROP TRIGGER IF EXISTS trg_media_watches_updated_at ON public.media_watches;
CREATE TRIGGER trg_media_watches_updated_at BEFORE UPDATE ON public.media_watches
  FOR EACH ROW EXECUTE FUNCTION update_updated_at();
DROP TRIGGER IF EXISTS trg_audit ON public.media_watches;
CREATE TRIGGER trg_audit AFTER INSERT OR UPDATE OR DELETE ON public.media_watches
  FOR EACH ROW EXECUTE FUNCTION public.log_audit();

-- Trigger functions only (none is callable as an RPC).
REVOKE ALL ON FUNCTION public.media_watch_before() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_watch_cache() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_watch_reconcile() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.media_rewatch_guard() FROM PUBLIC, anon, authenticated;
REVOKE ALL ON FUNCTION public.trakt_outbox_watch() FROM PUBLIC, anon, authenticated;

select public.owner_lock_apply('public.media_watches');
